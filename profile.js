// profile.js (Builds 1 to 4: patron list, patron profile, add/edit form, deactivate)
(() => {
  // db is created in supabase-config.js and used by auth.js. Do not declare it again.
  const $ = (id) => document.getElementById(id);

  // Text only, never innerHTML, so a name can never inject HTML.
  function cell(text) {
    const td = document.createElement('td');
    td.textContent = text ?? '';
    return td;
  }

  // Shows a message line, or hides it when the text is empty.
  function setMessage(el, text) {
    el.textContent = text || '';
    el.hidden = !text;
  }

  // Shows one message row inside a table body, styled like a data row.
  function showTableMessage(tbody, columns, text, isError = false) {
    const td = document.createElement('td');
    td.colSpan = columns;
    td.className = 'table-message' + (isError ? ' error' : '');
    td.textContent = text;
    const tr = document.createElement('tr');
    tr.className = 'message-row';
    tr.append(td);
    tbody.replaceChildren(tr);
  }

  // 'admin', 'staff' or null. Use a helper from auth.js instead if it has one.
  async function getRole() {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return null;
    const { data } = await db
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .maybeSingle();
    return data && data.status === 'active' ? data.role : null;
  }

  // ===== Patron list =====
  let patrons = [];
  let patronsLoaded = false;   // true once the list has loaded

  async function loadPatrons() {
    showTableMessage($('patron-rows'), 4, 'Loading patrons...');
    const { data, error } = await db
      .from('patrons')
      .select('id_number, full_name, type, status')
      .order('id_number', { ascending: true });
    if (error) {
      showTableMessage($('patron-rows'), 4, 'Could not load patrons: ' + error.message, true);
      return;
    }
    patrons = data;
    patronsLoaded = true;
    renderPatrons();
  }

  // Sorts a copy of the list by the chosen column and order. numeric: true puts L2 before L10.
  function sortPatrons(list, field, order) {
    const text = (v) => String(v ?? '');
    const same = (a, b) => text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' });
    const key = field || 'id_number';             // blank means the default column
    const direction = order === 'desc' ? -1 : 1;  // ascending unless Descending is chosen
    return [...list].sort((a, b) => direction * same(a[key], b[key]) || same(a.id_number, b.id_number));
  }

  // Search and sort run in the browser on the rows already loaded, which is fine for a demo-sized list.
  function renderPatrons() {
    const term = $('patron-search').value.trim().toLowerCase();
    const rows = patrons.filter((p) =>
      [p.id_number, p.full_name].some((v) => String(v ?? '').toLowerCase().includes(term)));

    const body = $('patron-rows');
    if (rows.length === 0) {
      showTableMessage(body, 4, patrons.length ? 'No matches.' : 'No patrons yet.');
      return;
    }
    body.replaceChildren();
    sortPatrons(rows, $('patron-sort').value, $('patron-order').value).forEach((p) => {
      const url = 'patron-profile.html?id=' + encodeURIComponent(p.id_number);

      const link = document.createElement('a');
      link.href = url;
      link.textContent = p.id_number;
      const idCell = document.createElement('td');
      idCell.append(link);

      const tr = document.createElement('tr');
      tr.className = 'clickable-row';
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;   // the ID link already navigates
        location.href = url;
      });
      tr.append(idCell, cell(p.full_name), cell(p.type), cell(p.status));
      body.append(tr);
    });
  }

  // Browsers remember form fields when you use Back or Forward. Start fresh each time.
  function resetListControls() {
    $('patron-search').value = '';
    $('patron-sort').value = '';
    $('patron-order').value = '';
    if (patronsLoaded) renderPatrons();
  }

  function onListPageShow(e) {
    resetListControls();
    setTimeout(resetListControls, 0);   // some browsers restore fields just after pageshow
    if (e.persisted) loadPatrons();     // back from the back/forward cache: refresh the data too
  }

  async function initList() {
    resetListControls();
    $('patron-search').addEventListener('input', renderPatrons);
    $('patron-sort').addEventListener('change', renderPatrons);
    $('patron-order').addEventListener('change', renderPatrons);
    window.addEventListener('pageshow', onListPageShow);
    loadPatrons();
    $('add-patron').hidden = (await getRole()) !== 'admin';
  }

  // ===== Patron profile =====
  let current = null;   // the patron being viewed

  const EVENT_LABELS = { check_in: 'Checked in', check_out: 'Checked out', correction: 'Correction' };

  function formatWhen(iso) {
    return new Date(iso).toLocaleString('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
    });
  }

  function showStatus() {
    $('p-status').textContent = current.status;
    $('toggle-status').textContent = current.status === 'active' ? 'Deactivate' : 'Reactivate';
  }

  // Deactivate or reactivate. A patron is never deleted, because the logs refer to the ID.
  async function setStatus(status) {
    const button = $('toggle-status');
    button.disabled = true;   // stops double clicks while it saves
    setMessage($('view-message'), '');
    const { data, error } = await db
      .from('patrons')
      .update({ status })
      .eq('id_number', current.id_number)
      .select();
    button.disabled = false;
    if (error || !data || data.length === 0) {
      setMessage($('view-message'), 'Could not change the status. Only an admin can do this.');
      return;
    }
    current.status = data[0].status;
    showStatus();
  }

  async function loadVisits(id) {
    const body = $('visit-rows');
    showTableMessage(body, 2, 'Loading visits...');
    const { data, error } = await db
      .from('attendance_logs')
      .select('event_type, event_time')
      .eq('id_number', id)
      .order('event_time', { ascending: false })
      .order('id', { ascending: false })
      .limit(10);
    if (error) {
      showTableMessage(body, 2, 'Could not load visits: ' + error.message, true);
      return;
    }
    if (data.length === 0) {
      showTableMessage(body, 2, 'No visits recorded yet.');
      return;
    }
    body.replaceChildren();
    data.forEach((v) => {
      const tr = document.createElement('tr');
      tr.append(cell(EVENT_LABELS[v.event_type] ?? v.event_type), cell(formatWhen(v.event_time)));
      body.append(tr);
    });
  }

  async function initView() {
    const id = new URLSearchParams(location.search).get('id');
    const { data, error } = await db
      .from('patrons')
      .select('id_number, full_name, type, status')
      .eq('id_number', id)
      .maybeSingle();
    if (error || !data) {
      setMessage($('view-message'), 'Patron not found.');
      return;
    }
    current = data;
    $('p-id').textContent = data.id_number;
    $('p-name').textContent = data.full_name;
    $('p-type').textContent = data.type;
    showStatus();
    loadVisits(data.id_number);

    // Admin buttons: Edit and Deactivate / Reactivate.
    $('admin-actions').hidden = (await getRole()) !== 'admin';
    $('edit-patron').href = 'patron-form.html?id=' + encodeURIComponent(current.id_number);
    $('toggle-status').addEventListener('click', () => {
      const next = current.status === 'active' ? 'inactive' : 'active';
      const action = next === 'inactive' ? 'Deactivate' : 'Reactivate';
      const note = next === 'inactive' ? ' Inactive IDs are rejected at check-in.' : '';
      if (confirm(action + ' ' + current.full_name + ' (' + current.id_number + ')?' + note)) setStatus(next);
    });
  }

  // ===== Add / edit patron form =====
  // The check-in page has no ID format rule: normaliseId in javascript-stuff.js only removes
  // spaces and makes letters uppercase. This form applies a simple rule to the cleaned ID:
  // 2 to 20 letters, numbers or hyphens (accepts L1, S1 and 2023-123456). Change it if the team agrees on another format.
  const ID_PATTERN = /^(?=.{2,20}$)[A-Z0-9]+(-[A-Z0-9]+)*$/;

  let mode = 'add';        // 'add' or 'edit'
  let originalId = null;   // the ID being edited

  // Same cleaning as normaliseId in javascript-stuff.js, so IDs match at check-in.
  function cleanId(value) {
    return String(value ?? '').replace(/\s+/g, '').toUpperCase();
  }

  function cleanName(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  function validatePatron(v) {
    const errors = {};
    if (mode === 'add') {   // the ID is locked when editing, so only check it when adding
      if (!v.id) errors.id = 'ID number is required.';
      else if (!ID_PATTERN.test(v.id)) errors.id = 'Use 2 to 20 letters, numbers or hyphens, for example L5 or 2023-123456.';
    }
    if (!v.name) errors.name = 'Full name is required.';
    else if (v.name.length < 2) errors.name = 'Full name is too short.';
    else if (v.name.length > 100) errors.name = 'Full name is too long (100 characters at most).';
    const typeOk = Array.from($('f-type').options).some((o) => o.value && o.value === v.type);
    if (!typeOk) errors.type = 'Choose a patron type.';
    return errors;
  }

  function showErrors(errors) {
    ['id', 'name', 'type'].forEach((f) => setMessage($('e-' + f), errors[f]));
  }

  async function savePatron() {
    const values = {
      id: cleanId($('f-id').value),
      name: cleanName($('f-name').value),
      type: $('f-type').value,
    };
    const errors = validatePatron(values);
    showErrors(errors);
    setMessage($('form-message'), '');
    if (Object.keys(errors).length) return;

    const saveButton = $('f-save');
    const finish = () => {
      saveButton.disabled = false;
      saveButton.textContent = 'Save';
    };
    saveButton.disabled = true;          // stops double submits
    saveButton.textContent = 'Saving...';

    if (mode === 'add') {
      // Friendly duplicate check. The unique rule in the database is the real protection.
      const { data: found } = await db
        .from('patrons')
        .select('id_number')
        .eq('id_number', values.id)
        .limit(1);
      if (found && found.length > 0) {
        showErrors({ id: 'This ID number already exists.' });
        finish();
        return;
      }
    }

    const request = mode === 'add'
      ? db.from('patrons')
          .insert({ id_number: values.id, full_name: values.name, type: values.type, status: 'active' })
          .select()
      : db.from('patrons')
          .update({ full_name: values.name, type: values.type })
          .eq('id_number', originalId)
          .select();
    const { data, error } = await request;
    finish();

    if (error && error.code === '23505') {   // duplicate ID number (database rule)
      showErrors({ id: 'This ID number already exists.' });
      return;
    }
    if (error && error.code === '42501') {   // blocked by database rules (RLS)
      setMessage($('form-message'), 'Only an admin can do this.');
      return;
    }
    if (error || !data || data.length === 0) {
      setMessage($('form-message'), 'Could not save. ' + (error ? error.message : 'No row was changed. Only an admin can do this.'));
      return;
    }
    location.href = 'patron-profile.html?id=' + encodeURIComponent(data[0].id_number);
  }

  async function initForm() {
    // Screen guard only. The real lock is the database rule (RLS).
    if ((await getRole()) !== 'admin') {
      location.href = 'patrons-list.html';
      return;
    }

    originalId = new URLSearchParams(location.search).get('id');
    if (originalId) {
      mode = 'edit';
      $('form-title').textContent = 'Edit patron';
      document.title = 'Edit Patron | Library Visit Desk';
      const { data } = await db
        .from('patrons')
        .select('id_number, full_name, type')
        .eq('id_number', originalId)
        .maybeSingle();
      if (!data) {
        setMessage($('form-message'), 'Patron not found.');
        $('f-save').disabled = true;
        return;
      }
      // Keep the current type selectable, even if it is not one of the usual words.
      const select = $('f-type');
      if (data.type && !Array.from(select.options).some((o) => o.value === data.type)) {
        select.append(new Option(data.type, data.type));
      }
      $('f-id').value = data.id_number;
      $('f-id').readOnly = true;   // the logs use the ID as the key, so it never changes
      $('id-hint').textContent = 'The ID number cannot be changed.';
      $('f-name').value = data.full_name;
      select.value = data.type;
      $('cancel-link').href = 'patron-profile.html?id=' + encodeURIComponent(data.id_number);
      $('f-name').focus();
    } else {
      $('f-id').focus();
    }

    $('patron-form').addEventListener('submit', (e) => {
      e.preventDefault();
      savePatron();
    });
  }

  // ===== Page switch =====
  const page = document.body.dataset.page;
  if (page === 'patron-list') initList();
  if (page === 'patron-view') initView();
  if (page === 'patron-form') initForm();
})();