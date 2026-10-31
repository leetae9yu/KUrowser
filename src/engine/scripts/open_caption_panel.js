(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const textOf = (el) => String((el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('data-title') || el.title)) || '').trim().replace(/\s+/g, ' ');
  const click = async (el) => {
    try {
      el.scrollIntoView && el.scrollIntoView({block: 'center', inline: 'center'});
      for (const type of ['mouseover', 'mouseenter', 'pointerdown', 'mousedown', 'click', 'mouseup', 'pointerup']) {
        el.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true, view: window}));
      }
      if (typeof el.click === 'function') el.click();
      await wait(350);
      return true;
    } catch (_) {
      return false;
    }
  };
  const clicked = [];
  const enableSelector = async (name, selector, onClass) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const classes = String(el.className || '');
    if (onClass && classes.includes(onClass)) {
      clicked.push(name + ':already-on');
      return true;
    }
    if (await click(el)) clicked.push(name + ':' + textOf(el).slice(0, 30));
    return true;
  };

  await enableSelector('caption-script', '.vc-pctrl-caption-script-btn', 'vc-pctrl-caption-script-on');
  await wait(500);
  await enableSelector('media-script', '.vc-pctrl-media-script-btn', 'vc-pctrl-media-script-on');
  await wait(500);

  try {
    if (window.showViewerCaptionScript) window.showViewerCaptionScript();
    if (window.initializeCaptionScriptUI) window.initializeCaptionScriptUI();
    if (window.setCaptionScriptList) window.setCaptionScriptList();
  } catch (_) {}

  return {clicked, hasVideo: !!document.querySelector('video'), url: location.href};
})()
