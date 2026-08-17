/* ==========================================================================
 * fs-tracker.js — FairStay Google Sheets integration helper
 * -------------------------------------------------------------------------
 * Include ONCE on every FairStay page (right after the page declares its
 * SCRIPT_URL, or in <head>). It normalises the customer context (name /
 * phone / email / location) + the selected service + the payment amount +
 * the payment status + the draft-file upload so the Google Apps Script
 * backend always receives the same schema.
 *
 * It degrades gracefully: if SCRIPT_URL is still the "PASTE_YOUR..."
 * placeholder, fsPost() resolves immediately (demo mode) and nothing
 * breaks.
 * ========================================================================== */

/**
 * Read the customer context from the URL query-string first (the lead modal
 * on index.html forwards ?name=&phone=&email=&city=&customer_id=) and fall
 * back to localStorage. Generates a customer_id if none exists yet.
 */
function fsContext() {
  var params = new URLSearchParams(window.location.search);
  function q(n) { return params.get(n) || ''; }
  function ls(k) {
    try { return localStorage.getItem(k) || ''; } catch (e) { return ''; }
  }
  var ctx = {
    name: q('name') || ls('fs_name') || '',
    phone: q('phone') || ls('fs_phone') || '',
    email: q('email') || ls('fs_email') || '',
    location: q('city') || q('location') || ls('fs_city') || '',
    customer_id: q('customer_id') || ls('fs_customer_id') || '',
    service: q('service') || '',
    plan: q('plan') || ''
  };
  if (!ctx.customer_id) {
    ctx.customer_id = 'FS' + Date.now().toString(36).toUpperCase().slice(-8);
  }
  return ctx;
}

function fsMapTargetToService(target) {
  var map = {
    'rental-details.html': 'Rental Agreement',
    'rental-draft.html': 'Rental Agreement',
    'packers-movers.html': 'Packers & Movers',
    'find-property.html': 'Find Property',
    'list-property.html': 'List Property',
    'coming-soon.html': 'General Inquiry'
  };
  return map[target] || 'General Inquiry';
}

/**
 * Append the standardised columns onto an existing FormData before POST.
 *   formData  – the FormData you already built from your <form>
 *   service   – e.g. "Rental Agreement" | "Packers & Movers" | ...
 *   amount    – the payment amount (number) or '' if none
 *   status    – "success" | "pending" | "rejected" (defaults to "pending")
 * Returns the resolved service name.
 */
function fsEnrich(formData, service, amount, status) {
  var ctx = fsContext();
  if (!service) {
    var target = formData.get('target') || window.location.pathname.split('/').pop();
    service = ctx.service || fsMapTargetToService(target) || 'General Inquiry';
  }
  formData.set('service', service);
  formData.set('name', formData.get('name') || formData.get('customer_name') || formData.get('owner_name') || ctx.name);
  formData.set('phone', formData.get('phone') || formData.get('customer_phone') || formData.get('owner_phone') || ctx.phone);
  formData.set('email', formData.get('email') || formData.get('customer_email') || formData.get('owner_email') || ctx.email);
  formData.set('location', formData.get('location') || formData.get('city') || formData.get('customer_city') || formData.get('from_city') || ctx.location);
  formData.set('customer_id', formData.get('customer_id') || ctx.customer_id);
  formData.set('payment_amount', (amount == null ? '' : amount));
  formData.set('payment_status', status || 'pending');
  formData.set('timestamp', new Date().toISOString());
  return service;
}

/**
 * Read a File as a base64 payload (reliable for Apps Script).
 * Callback receives { base64, name, mime }.
 */
function fsFileToBase64(file, cb) {
  var reader = new FileReader();
  reader.onload = function () {
    var dataUrl = reader.result || '';
    var parts = dataUrl.split(',');
    var mimeMatch = parts[0].match(/:(.*?);/);
    var mime = mimeMatch ? mimeMatch[1] : (file.type || 'application/octet-stream');
    var b64 = parts[1] || '';
    cb({ base64: b64, name: file.name, mime: mime });
  };
  reader.onerror = function () { cb({ base64: '', name: file.name, mime: file.type || '' }); };
  reader.readAsDataURL(file);
}

/**
 * Fire-and-forget POST to the Apps Script web app (mode: no-cors, same as
 * the rest of the site). Returns a Promise that resolves immediately in
 * demo mode (placeholder URL) so callers never error out.
 *
 * NOTE: pages declare SCRIPT_URL with `const` (index, find-property,
 * list-property, packers-movers). `const`/`let` do NOT attach to window, so
 * we must read `SCRIPT_URL` directly by name (a global lexical binding that
 * exists by the time this is called), not via window.SCRIPT_URL.
 */
function fsPost(formData) {
  var url = '';
  if (window.FS_SCRIPT_URL) {
    url = window.FS_SCRIPT_URL;
  } else if (typeof SCRIPT_URL !== 'undefined') {
    url = SCRIPT_URL;
  }
  if (!url || url === 'PASTE_YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
    return Promise.resolve({ _demo: true });
  }
  return fetch(url, {
    method: 'POST',
    body: formData
}).then(function (response) {
    if (!response.ok) {
        throw new Error('Apps Script request failed: HTTP ' + response.status);
    }
    return response.json();
});
}

/**
 * "Confirm Payment" helper — posts action=mark_paid so the backend flips the
 * lead's Status column to "Success" and adds the amount to revenue.
 *   amount – the total payable (number), optional
 *   cb    – optional callback(success:boolean)
 */
function fsMarkPaid(amount, cb) {
  var ctx = fsContext();
  var fd = new FormData();
  fsEnrich(fd, ctx.service || 'Rental Agreement', amount, 'success');
  fd.set('action', 'mark_paid');
  fsPost(fd).then(function () { if (cb) cb(true); }).catch(function () { if (cb) cb(false); });
}

/**
 * Parse a currency string like "₹ 12,349.00" back into a number.
 */
function fsParseCurrency(v) {
  var n = parseFloat(String(v || '').replace(/[^0-9.,]/g, '').replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Inject the "Confirm Payment" button into the payment breakdown box
 * (rental pages only). Idempotent — adds the button once.
 */
function fsInitConfirmPayBox() {
  var pb = document.getElementById('paymentBox');
  if (!pb || document.getElementById('confirmPayBtn')) return;
  var b = document.createElement('button');
  b.id = 'confirmPayBtn';
  b.type = 'button';
  b.style.cssText = 'width:auto;margin-top:10px;background:#0b8a63;color:#fff;border:0;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:700;';
  b.textContent = '✅ I’ve Made the Payment — Mark as Paid';
  b.onclick = fsConfirmPay;
  pb.appendChild(b);
}

/**
 * "Confirm Payment" handler — posts action=mark_paid so the backend sets the
 * lead's Status column to "Success" and adds the total payable to revenue.
 */
function fsConfirmPay() {
  var totalEl = document.getElementById('pbTotal');
  var amount = fsParseCurrency(totalEl ? totalEl.textContent : '0');
  var btn = document.getElementById('confirmPayBtn');
  if (btn) { btn.textContent = 'Updating…'; btn.disabled = true; }
  fsMarkPaid(amount, function (ok) {
    if (btn) {
      btn.textContent = ok ? '✅ Payment received — Status: Success' : 'Update failed — retry';
      btn.disabled = !ok;
    } else if (!ok) {
      alert('Could not update payment status. Please try again.');
    }
  });
}

/**
 * Compute the rental "Total Payable" from the rental form (mirrors the on-page
 * payment breakdown: processing ₹399 + stamp duty + plan pack). Used so the
 * Payment Amount column is captured at submission time, not only on confirm.
 */
function fsRentalTotalFrom(form) {
  function num(name) {
    var el = (form && form.elements) ? form.elements[name] : null;
    var v = parseFloat(el ? el.value : '');
    return isNaN(v) ? 0 : v;
  }
  var ctx = fsContext();
  var plan = String(ctx.plan || '').toLowerCase().trim();
  var packPrices = { standard: 149, premium: 249, luxury: 399 };
  var pack = packPrices[plan] || packPrices.standard;
  var rent = num('rent_amount');
  var dep = num('deposit_amount');
  var stamp = Math.min((rent * 11 + dep) * 0.005, 500); // 0.5% capped at ₹500
  return 399 + stamp + pack;
}
