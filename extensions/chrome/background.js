// Grain's browser extension: right-click an image, ask who made it.
//
// Deliberately tiny. Its only permission is the context menu: it cannot read
// pages, see browsing history or touch any site. It hands the image's address
// to Grain, which fetches and checks it the same way the website checks an
// upload -- the watermark and the fingerprint, against the registry on Monad.

const SITE = 'https://grain-on-monad.vercel.app';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'grain-check',
    title: 'Who made this image? (Grain)',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== 'grain-check') return;
  const src = info.srcUrl ?? '';
  // Inline (data:) and page-local (blob:) images have no address Grain can
  // fetch; open the checker so the person can drop or paste it instead.
  const url = /^https?:\/\//i.test(src)
    ? `${SITE}/verify?url=${encodeURIComponent(src)}`
    : `${SITE}/verify?from=extension`;
  chrome.tabs.create({ url });
});

// The toolbar button opens the checker for drag-and-drop or paste.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: `${SITE}/verify` });
});
