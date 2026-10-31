(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const out = [];
  const fmt = (value) => {
    const n = Math.max(0, Number(value) || 0);
    const h = String(Math.floor(n / 3600)).padStart(2, '0');
    const m = String(Math.floor((n % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(n % 60)).padStart(2, '0');
    const ms = String(Math.round((n - Math.floor(n)) * 1000)).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  };
  const cuesToVtt = (cues) => {
    const lines = ['WEBVTT', ''];
    for (const cue of Array.from(cues || [])) {
      const text = String(cue && cue.text || '').trim();
      if (!text) continue;
      lines.push(`${fmt(cue.startTime ?? cue.start ?? 0)} --> ${fmt(cue.endTime ?? cue.end ?? 0)}`, text, '');
    }
    return lines.join('\n').trim() + '\n';
  };
  const pushCaptionList = (list, source) => {
    for (const item of Array.from(list || [])) {
      const caption = item && item.caption;
      const text = cuesToVtt(caption && caption.cues);
      if (text.trim() !== 'WEBVTT') {
        out.push({
          source,
          label: item.label || item.lang || '',
          language: item.lang || '',
          format: 'vtt',
          text,
        });
      }
    }
  };
  const openPlayerCaptionScript = async () => {
    try {
      const cpi = window.uniPlayerConfig && uniPlayerConfig.getContentPlayingInfoData && uniPlayerConfig.getContentPlayingInfoData();
      const firstIdx = window.uniPlayerConfig && uniPlayerConfig.getFirstStoryIdx && Number(uniPlayerConfig.getFirstStoryIdx());
      if (cpi && Number.isFinite(firstIdx) && cpi.setCurrentStoryPlayingInfo) {
        cpi.setCurrentStoryPlayingInfo(firstIdx);
      }
      if (window.uniPlayerConfig && uniPlayerConfig.organizeCurrStoryPlayingInfo) {
        await Promise.race([
          new Promise((resolve) => uniPlayerConfig.organizeCurrStoryPlayingInfo(resolve)),
          wait(5000),
        ]);
      }
      if (window.uniPlayerConfig && uniPlayerConfig.parseClosedCaption) {
        await Promise.race([
          new Promise((resolve) => uniPlayerConfig.parseClosedCaption(resolve)),
          wait(10000),
        ]);
      }
      const list = window.GetCaptionList ? GetCaptionList() : (window.uniPlayerConfig && uniPlayerConfig.getClosedCaptionList && uniPlayerConfig.getClosedCaptionList());
      if (Array.isArray(list)) {
        window.captionScriptList = list;
        pushCaptionList(list, 'player_caption_api');
        if (window.showViewerCaptionScript) showViewerCaptionScript();
        if (window.initializeCaptionScriptUI) initializeCaptionScriptUI();
        if (window.setCaptionScriptList) setCaptionScriptList();
      }
    } catch (_) {}
  };
  const captureTrackCues = async () => {
    for (const video of Array.from(document.querySelectorAll('video'))) {
      for (const track of Array.from(video.textTracks || [])) {
        try { track.mode = 'hidden'; } catch (_) {}
      }
    }
    await wait(500);
    for (const video of Array.from(document.querySelectorAll('video'))) {
      for (const track of Array.from(video.textTracks || [])) {
        const cues = Array.from(track.cues || track.activeCues || []).map((cue) => ({start: cue.startTime || 0, end: cue.endTime || 0, text: cue.text || ''})).filter((cue) => cue.text);
        if (cues.length) out.push({source: 'text_track_cues', label: track.label || '', language: track.language || '', format: 'vtt', cues, text: ''});
      }
    }
  };
  const fetchTrackElements = async () => {
    for (const track of Array.from(document.querySelectorAll('track[src]'))) {
      const src = track.src || track.getAttribute('src') || '';
      if (!src) continue;
      try {
        const response = await fetch(src, {credentials: 'include'});
        if (response.ok) {
          const text = await response.text();
          if (text.trim()) out.push({source: 'track_element', label: track.label || '', language: track.srclang || track.getAttribute('srclang') || '', format: src.toLowerCase().includes('.srt') ? 'srt' : 'vtt', text});
        }
      } catch (_) {}
    }
  };
  const fetchCaptionResources = async () => {
    const names = performance.getEntriesByType('resource').map((r) => r.name).filter((name) => /caption|subtitle|transcript|media_script|script_list|\.vtt|\.srt|\.ttml|\.dfxp|\.smi/i.test(name) && !/\.js(?:[?#]|$)/i.test(name));
    for (const name of names) {
      try {
        const response = await fetch(name, {credentials: 'include'});
        if (!response.ok) continue;
        const text = await response.text();
        if (/caption|subtitle|transcript|media_script|<text|<p|WEBVTT|-->|자막|스크립트/i.test(text) && !/<html[\s>]/i.test(text) && !/(^|\n)\s*(var|function)\b/.test(text.slice(0, 1000))) {
          out.push({source: 'player_caption_resource', label: '', language: '', format: name.toLowerCase().includes('.xml') ? 'xml' : '', text});
        }
      } catch (_) {}
    }
  };
  const scrapeCaptionScriptList = () => {
    const roots = [document];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    for (const root of roots) {
      const items = Array.from(root.querySelectorAll('#cs-script-list .cs-script-item, .cs-script-item'));
      const lines = [];
      for (const item of items) {
        const textEl = item.querySelector && item.querySelector('.cs-script-item-text');
        const timeEl = item.querySelector && item.querySelector('.cs-script-item-time');
        const text = String((textEl && (textEl.innerText || textEl.textContent)) || '').trim().replace(/\s+/g, ' ');
        const time = String((timeEl && (timeEl.innerText || timeEl.textContent)) || '').trim();
        if (!text) continue;
        lines.push(time ? `[${time}] ${text}` : text);
      }
      if (lines.length) {
        out.push({
          source: 'caption_script_dom',
          label: '한국어 스크립트',
          language: 'ko',
          format: 'txt',
          text: lines.join('\n') + '\n',
        });
      }
    }
  };
  await openPlayerCaptionScript();
  scrapeCaptionScriptList();
  await fetchTrackElements();
  await captureTrackCues();
  await fetchCaptionResources();
  scrapeCaptionScriptList();
  return out.map((item) => {
    if (item.cues && !item.text) {
      item.text = cuesToVtt(item.cues);
    }
    delete item.cues;
    return item;
  });
})()
