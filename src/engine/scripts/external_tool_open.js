(() => {
  const textOf = (el) => String((el && (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.title)) || '').trim().replace(/\s+/g, ' ');
  const form = document.querySelector('form#tool_form, form[action*=learningx], form[action*=lti]');
  if (form) {
    form.target = '_self';
    if (form.requestSubmit) form.requestSubmit();
    else HTMLFormElement.prototype.submit.call(form);
    return 'submitted_form';
  }
  const launch = Array.from(document.querySelectorAll('button,input[type="submit"],a,[role="button"]')).find((el) => /새 창에|로드|load/i.test(textOf(el)));
  if (launch) {
    launch.click();
    return 'clicked_launch';
  }
  return 'none';
})()
