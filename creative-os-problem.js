/* Read-only export diagnostics. Opening/dismissing never persists a shift. */
(function (root) {
  'use strict';
  function editorSafe(shift) {
    if (!shift || typeof shift.title !== 'string' || typeof (shift.details || shift.room || '') !== 'string' ||
        !['blue', 'amber', 'red', 'violet'].includes(shift.colorCode)) return false;
    try {
      for (const value of [shift.start, shift.end]) {
        // The existing editor slices to minutes. Only enter it when that preserves the stored values.
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
        root.CreativeOSExport.wall(value, 'UTC'); // Check calendar validity without changing any value.
      }
      return true;
    } catch { return false; }
  }
  function show(error, getShifts, openEditor, options = {}) {
    const problem = error.problemShift;
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', options.title || 'Creative OS export problem');
    dialog.style.cssText = 'background:#0f172a;color:#e2e8f0;border:1px solid #475569;border-radius:16px;padding:24px;width:560px;max-width:90vw;max-height:85vh;overflow:auto';
    function element(tag, text) {
      const node = document.createElement(tag); node.textContent = text; dialog.appendChild(node); return node;
    }
    element('h2', options.title || 'Creative OS export failed');
    const message = element('pre', error.message);
    message.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:inherit';
    const open = element('button', 'Open Problem Shift');
    const dismiss = element('button', 'Dismiss');
    for (const button of [open, dismiss]) {
      button.type = 'button'; button.style.cssText = 'margin:12px 12px 0 0;padding:10px;border:1px solid #64748b;border-radius:8px;cursor:pointer';
    }
    function close() { dialog.close(); dialog.remove(); }
    dismiss.onclick = close;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    open.onclick = () => {
      const matches = typeof problem.id === 'string' && problem.id.trim() ? getShifts().filter(s => s?.id === problem.id) : [];
      if (!options.readOnly && matches.length === 1 && editorSafe(matches[0])) {
        close(); openEditor(problem.id); return;
      }
      // Never choose by title or array position, or pass malformed times into the existing editor.
      const record = matches.length === 1 ? matches[0] : problem.record;
      const fields = [['Title', 'title'], ['ID', 'id'], ['Details', 'details'], ['Room', 'room'],
        ['Color / category', 'colorCode'], ['Legacy urgent care', 'urgentCare'], ['Stored start', 'start'], ['Stored end', 'end'],
        ['Legacy date', 'date'], ['Legacy startTime', 'startTime'], ['Legacy endTime', 'endTime']];
      message.textContent = error.message + '\n\nProblem shift — read-only\n' + fields.map(([label, key]) =>
        label + ': ' + (JSON.stringify(record?.[key]) ?? '(not stored)')).join('\n') + '\n\n' +
        (options.readOnly ? 'Historical inspection is read-only. Nothing was saved, corrected or deleted.' : matches.length !== 1 ? 'This ID is missing or no longer unique. No record was selected for editing.' :
          'The stored fields cannot safely open in the current editor. They are shown exactly as stored; nothing was saved or corrected.');
      open.hidden = true;
    };
    if (options.readOnly) open.onclick();
    document.body.appendChild(dialog); dialog.showModal();
  }
  root.CreativeOSProblem = {show};
})(typeof globalThis !== 'undefined' ? globalThis : this);
