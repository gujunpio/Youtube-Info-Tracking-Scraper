// background.js — service worker
// Scraping is handled directly by popup.js (tabs + scripting APIs work there).

chrome.runtime.onInstalled.addListener(() => {
  console.log('YT Channel Scraper extension installed.');
});
