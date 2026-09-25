//! A long-lived TrustMark daemon.
//!
//! WHY THIS EXISTS. The `trustmark` CLI loads a 45 MB ONNX decoder from disk on
//! every invocation. Measured against the resolver, that is roughly 2 seconds
//! of a 3.2 second resolve — pure startup, before any pixels are looked at.
//! Everything else in a resolve sums to about 1.2 seconds, so the model load is
//! the entire gap between where we are and SPEC 8.2's under-two-second target.
//!
//! Loading the model once and holding it removes that cost. The protocol is
//! newline-delimited JSON on stdin and stdout, which keeps the resolver in
//! TypeScript and avoids binding the library through FFI.
//!
//! Requests:
//!   {"op":"decode","path":"/tmp/x.png"}
//!   {"op":"encode","path":"/tmp/in.png","out":"/tmp/out.png","bits":"0000...","strength":0.95}
//!
//! Responses:
//!   {"ok":true,"bits":"0101..."}          decode hit
//!   {"ok":true,"bits":null}               decode miss — the common case, not an error
//!   {"ok":true}                           encode done
//!   {"ok":false,"error":"..."}

use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use trustmark::{Trustmark, Variant, Version};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum Request {
    Decode { path: String },
    Encode {
        path: String,
        out: String,
        bits: String,
        /// WM_STRENGTH. The crate documents 0.95 as normal.
        #[serde(default = "default_strength")]
        strength: f32,
    },
    Ping,
}

fn default_strength() -> f32 {
    0.95
}

#[derive(Serialize)]
struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    bits: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl Response {
    fn ok() -> Self {
        Self { ok: true, bits: None, error: None }
    }
    fn decoded(bits: Option<String>) -> Self {
        Self { ok: true, bits: Some(bits), error: None }
    }
    fn err(e: impl std::fmt::Display) -> Self {
        Self { ok: false, bits: None, error: Some(e.to_string()) }
    }
}

fn main() -> io::Result<()> {
    let models = std::env::args().nth(1).unwrap_or_else(|| ".tools/models".to_string());

    // Variant Q per SPEC 5.2, BCH_SUPER per the Milestone 0 measurement: 40
    // data bits is far more than a recordId needs, and it corrects 8 bit flips
    // against BCH_5's 5. Robustness is the scarce resource, capacity is not.
    let tm = match Trustmark::new(PathBuf::from(&models), Variant::Q, Version::BchSuper) {
        Ok(tm) => tm,
        Err(e) => {
            eprintln!("trustmarkd: failed to load models from {models}: {e}");
            std::process::exit(1);
        }
    };

    eprintln!("trustmarkd: ready (variant Q, BCH_SUPER, models at {models})");

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<Request>(&line) {
            Err(e) => Response::err(format!("bad request: {e}")),
            Ok(Request::Ping) => Response::ok(),
            Ok(Request::Decode { path }) => match image::open(&path) {
                Err(e) => Response::err(e),
                // A failed decode is the normal case, not an error: most images
                // carry no watermark at all.
                Ok(img) => Response::decoded(tm.decode(img).ok()),
            },
            Ok(Request::Encode { path, out, bits, strength }) => match image::open(&path) {
                Err(e) => Response::err(e),
                Ok(img) => match tm.encode(bits, img, strength) {
                    Err(e) => Response::err(e),
                    Ok(marked) => match marked.save(&out) {
                        Err(e) => Response::err(e),
                        Ok(()) => Response::ok(),
                    },
                },
            },
        };

        writeln!(stdout, "{}", serde_json::to_string(&response).unwrap())?;
        stdout.flush()?;
    }

    Ok(())
}
