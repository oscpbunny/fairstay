/**
 * FairStay.co.in - Google Apps Script Backend
 * Deploy as a Web App: "Execute as: Me", "Who has access: Anyone"
 *
 * 1. Receives every POST from the FairStay static site.
 * 2. Captures LOGIN details (Name, Phone, Email, Location) on a master
 *    "Leads" sheet keyed by customer_id (upserted on each submit).
 * 3. Routes each submission to a SERVICE sub-sheet (one tab per service):
 *    Rental Agreement / Packers & Movers / Find Property / List Property.
 * 4. Stores Payment Amount + a dedicated "Status" column:
 *      paid  -> "Success" | not paid -> "Pending" | not convertible -> "Rejected"
 * 5. Upload a draft image to Google Drive, write the Drive LINK back on the sheet.
 * 6. Builds a "Report" tab: Total Revenue + month-wise
 *    Pending / Success / Rejected leads.
 *
 * Columns (identical on every sheet):
 *   Timestamp | Month | Customer ID | Name | Phone | Email | Location |
 *   Service | Details | Payment Amount | Status | Draft Drive Link |
 *   Request ID | Last Updated
 *
 * See setup-google-sheet.txt for deployment + configuration steps.
 */

/* ====================== CONFIGURATION ====================== */
/* Replace these IDs OR (preferably) set them in
 * Extensions -> Apps Script -> Project Settings -> Script properties. */
var CONFIG = {
  SPREADSHEET_ID: '1UWnYNEgjWe8UrX3uehqX-rheflGmw4GKWO3prYbVSFU',
  DRAFTS_FOLDER_ID: '1qFl2L-Vg5o8NzgF6DOAcr4ZixMfzDppu',
  STATUS_PENDING: 'Pending',
  STATUS_SUCCESS: 'Success',
  STATUS_REJECTED: 'Rejected'
};

/* ====================== CONSTANTS ====================== */
var HEADERS = [
  'Timestamp', 'Month', 'Customer ID', 'Name', 'Phone', 'Email', 'Location',
  'Service', 'Details', 'Payment Amount', 'Status', 'Draft Drive Link',
  'Request ID', 'Last Updated'
];
var LEAD_SHEET_NAME = 'Leads';
var REPORT_SHEET_NAME = 'Report';

/* ====================== ENTRY POINTS ====================== */

/**
 * GET -> tiny admin console (init sheets, refresh report, flip a lead status).
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('AdminPage')
    .setTitle('FairStay - Backend Admin')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * POST -> every form submission from the site lands here.
 */
function doPost(e) {
    return safeJson(function () {
    var ss = getSpreadsheet();
    var p = e.parameter || {};
    // Confirm Payment button → just flip the lead status to "Success" (no new row).
    if (normalize(p.action).toLowerCase() === 'mark_paid') {
      return markLeadStatus(normalize(p.customer_id), 'success', p.payment_amount);
    }
    var tz = Session.getScriptTimeZone();
    var now = new Date();
    var timestamp = formatDate(now, tz);
    var month = formatMonth(now, tz);

    /* ---- customer context (login details) ---- */
    var customerId = normalize(p.customer_id) || generateCustomerId();
    var name = normalize(p.name || p.customer_name);
    var phone = normalize(p.phone || p.customer_phone);
    var email = normalize(p.email || p.customer_email);
    var location = normalize(p.location || p.city || p.customer_city || p.from_city);
    var service = resolveService(p);
    var serviceTab = sanitizeSheetName(service);
    var requestId = normalize(p.request_id || p.booking_id);

    /* ---- payment + status ---- */
    var paymentAmount = Number(normalize(p.payment_amount || p.total_amount)) || 0;
    var status = resolveStatus(p.payment_status || p.status);

    /* ---- details (JSON of every non-standard field) ---- */
    var details = buildDetails(p);

    /* ---- draft file -> Google Drive ---- */
    var draftLink = '';
    if (p.draft_file_base64) {
      var folderId = getSetting('DRAFTS_FOLDER_ID');
      if (folderId && folderId !== 'YOUR_DRIVE_FOLDER_ID_HERE') {
        draftLink = uploadDraftToDrive(p.draft_file_base64, p.draft_file_name, p.draft_mime, customerId, service, folderId);
      } else {
        draftLink = '[Drive folder not configured - see fairstay-backend.gs]';
      }
    }

    /* ---- ensure the tabs exist ---- */
    ensureSheet(ss, LEAD_SHEET_NAME, true);
    ensureSheet(ss, serviceTab, true);
    ensureSheet(ss, REPORT_SHEET_NAME, false);

    /* ---- 1) append full audit row to the SERVICE sub-sheet ---- */
    var serviceRow = buildRow(timestamp, month, customerId, name, phone, email,
      location, service, details, paymentAmount, status, draftLink, requestId, timestamp);
    appendRowSafe(ss.getSheetByName(serviceTab), serviceRow);

    /* ---- 2) upsert LOGIN details on the master Leads sheet ---- */
    upsertLead(ss.getSheetByName(LEAD_SHEET_NAME), customerId, name, phone, email,
      location, service, details, paymentAmount, status, draftLink, requestId, timestamp, month);

    /* ---- 3) refresh the analytics report ---- */
    refreshReport(ss);

    return {
      result: 'success', customer_id: customerId, service: service,
      sheet: serviceTab, status: status,
            payment_amount: paymentAmount, draft_link: draftLink
    };
  }, 'doPost');
}

/* ====================== CORE HELPERS ====================== */

function getSetting(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  return (v && v !== '') ? v : CONFIG[key];
}

function getSpreadsheet() {
  var id = getSetting('SPREADSHEET_ID');
  if (!id || id === 'YOUR_SPREADSHEET_ID_HERE') {
    throw new Error('SPREADSHEET_ID is not configured. Set it in the code or in Script Properties.');
  }
  return SpreadsheetApp.openById(id);
}

// POST -> JSON response; never throws an HTTP 500 (no-cors fetches resolve cleanly).
function safeJson(fn, label) {
  try {
    var out = fn();
    return ContentService.createTextOutput(JSON.stringify(out))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      result: 'error', error: String(err), where: label || 'app'
    })).setMimeType(ContentService.MimeType.JSON)
      .setHeader('Access-Control-Allow-Origin', '*');
  }
}

function normalize(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) v = v[0];
  return String(v).trim();
}

// Decide the canonical service name from the params the front-end sends.
function resolveService(p) {
  var s = normalize(p.service || '');
  if (s) return normalizeService(s);
  s = normalize(p.service_type || '');
  if (s) return normalizeService(s);
  var target = normalize(p.target || '');
  var byTarget = {
    'rental-details.html': 'Rental Agreement', 'rental-draft.html': 'Rental Agreement',
    'packers-movers.html': 'Packers & Movers', 'find-property.html': 'Find Property',
    'list-property.html': 'List Property', 'coming-soon.html': 'General Inquiry'
  };
  if (byTarget[target]) return byTarget[target];
  if (p.plan) return 'Rental Agreement';
  return 'General Inquiry';
}

function normalizeService(s) {
  var low = String(s).toLowerCase().replace(/[(&].*$/, '').trim();
  if (low.indexOf('rental') !== -1 || low.indexOf('agreement') !== -1) return 'Rental Agreement';
  if (low.indexOf('packer') !== -1 || low.indexOf('mover') !== -1 || low.indexOf('shift') !== -1) return 'Packers & Movers';
  if (low.indexOf('find') !== -1 || low.indexOf('property for') !== -1) return 'Find Property';
  if (low.indexOf('list') !== -1) return 'List Property';
  return s || 'General Inquiry';
}

// Status: "Success" when paid, "Pending" otherwise.
// Front-end sends payment_status = 'success' | 'pending' | 'rejected'
function resolveStatus(raw) {
  var r = normalize(raw).toLowerCase();
  if (r === 'success' || r === 'paid') return CONFIG.STATUS_SUCCESS;
  if (r === 'rejected' || r === 'reject') return CONFIG.STATUS_REJECTED;
  return CONFIG.STATUS_PENDING;
}

function resolveStatusSimple(raw) {
  var r = normalize(raw).toLowerCase();
  if (r === 'success' || r === 'paid') return CONFIG.STATUS_SUCCESS;
  if (r === 'rejected' || r === 'reject') return CONFIG.STATUS_REJECTED;
  return CONFIG.STATUS_PENDING;
}

// Compact "Details" string: every non-standard submitted field as key: value.
function buildDetails(p) {
  var ignore = {
    customer_id: 1, name: 1, phone: 1, email: 1, location: 1, city: 1,
    customer_name: 1, customer_phone: 1, customer_email: 1, customer_city: 1,
    customer_plan: 1, plan: 1, service: 1, service_type: 1, target: 1, status: 1,
    payment_status: 1, payment_amount: 1, total_amount: 1,
    draft_file_base64: 1, draft_file_name: 1, draft_mime: 1, draft_file: 1,
    request_id: 1, booking_id: 1, timestamp: 1, action: 1
  };
  var parts = [];
  for (var k in p) {
    if (!Object.prototype.hasOwnProperty.call(p, k) || ignore[k] || k.toLowerCase() === 'submit') continue;
    var val = normalize(p[k]);
    if (val === '') continue;
    parts.push(k + ': ' + val);
  }
  var str = parts.join(' | ');
  return (str.length > 4000) ? (str.substring(0, 3997) + '...') : str;
}

function generateCustomerId() {
  return 'FS' + (Date.now().toString(36).toUpperCase().slice(-8));
}

function formatDate(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss'); }
function formatMonth(d, tz) { return Utilities.formatDate(d, tz, 'MMM yyyy'); }

// Sheet tab names cannot contain : [ ] * ? / \ and must be <100 chars.
function sanitizeSheetName(name) {
  var n = String(name || 'General').replace(/[\[\]\\*?@\/]/g, '_').replace(/:/g, '-').trim();
  if (n.length > 90) n = n.substring(0, 90);
  return n || 'General';
}

function ensureSheet(ss, name, withHeaders) {
  try {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (withHeaders && sh.getLastRow() === 0) setHeaders(sh);
    return sh;
  } catch (err) {
    var safe = sanitizeSheetName(name);
    var sh2 = ss.getSheetByName(safe) || ss.insertSheet(safe);
    if (withHeaders && sh2.getLastRow() === 0) setHeaders(sh2);
    return sh2;
  }
}

function setHeaders(sh) {
  sh.clear();
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  try { sh.setFrozenRows(1); } catch (err) {}
  try { sh.autoResizeColumns(1, HEADERS.length); } catch (err) {}
}

function buildRow(ts, month, cid, name, phone, email, location, service, details, amount, status, link, reqId, updated) {
  return [ts, month, cid, name, phone, email, location, service, details, amount, status, link, reqId, updated];
}

function appendRowSafe(sh, row) {
  try { sh.appendRow(row); }
  catch (err) {
    var ss = sh.getParent();
    var fresh = ensureSheet(ss, sh.getName(), true);
    fresh.appendRow(row);
  }
}

// Upsert the master Leads row by Customer ID.
function upsertLead(leadSheet, cid, name, phone, email, location, service,
  details, amount, status, link, reqId, ts, month) {
  var headers = leadSheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var idx = headerIndex(headers);
  if (!idx.customer_id && !idx.name) { setHeaders(leadSheet); idx = headerIndex(HEADERS); }

  var data = leadSheet.getDataRange().getValues();
  var foundRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.customer_id]).trim() === String(cid).trim()) { foundRow = i + 1; break; }
  }

  var tz = Session.getScriptTimeZone(), now = new Date();
  var updated = formatDate(now, tz);
  var currentMonth = formatMonth(now, tz);

  if (foundRow > 0) {
    var row = leadSheet.getRange(foundRow, 1, 1, HEADERS.length).getValues()[0];
    row[idx.timestamp] = row[idx.timestamp] || ts;        // keep original login time
    row[idx.month] = currentMonth;                        // latest event month (for report)
    row[idx.customer_id] = cid;
    row[idx.name] = name;
    row[idx.phone] = phone;
    row[idx.email] = email;
    row[idx.location] = location;
    row[idx.service] = service;
    row[idx.details] = details;
    row[idx.amount] = amount;
    row[idx.status] = status;
    row[idx.draft_link] = link;
    row[idx.request_id] = reqId;
    row[idx.last_updated] = updated;
    leadSheet.getRange(foundRow, 1, 1, HEADERS.length).setValues([row]);
  } else {
    var newRow = buildRow(ts, currentMonth, cid, name, phone, email, location,
      service, details, amount, status, link, reqId, updated);
    leadSheet.appendRow(newRow);
  }
}

// Draft file upload to Drive (base64 in -> Drive link out).
function uploadDraftToDrive(b64, fileName, mime, customerId, service, folderId) {
  try {
    var decoded = Utilities.base64Decode(b64);
    var folder = DriveApp.getFolderById(folderId);
    var stamp = formatDate(new Date(), Session.getScriptTimeZone()).replace(/[-: ]/g, '');
    var safeName = (fileName || (customerId + '_draft')) + '_' + stamp;
    safeName = safeName.replace(/[^a-zA-Z0-9._-]/g, '_');
    var blob = decoded.setContentType(mime || 'application/octet-stream');
    var file = folder.createFile(blob).setName(safeName);
        return file.getUrl() || ('https://drive.google.com/file/d/' + file.getId() + '/view');
  } catch (err) {
    return '[upload failed: ' + String(err) + ']';
  }
}

/* =============== ADMIN: status update (mark Rejected / Paid) =============== */

/**
 * Flip a lead's status + payment amount by customer_id.
 * Called from the admin page; reachable via the front-end "Confirm Payment" button.
 */
function markLeadStatus(customerId, status, paymentAmount) {
  var ss = getSpreadsheet();
  var leadSheet = ensureSheet(ss, LEAD_SHEET_NAME, true);
  var headers = leadSheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  var idx = headerIndex(headers);
  if (!idx.customer_id) { setHeaders(leadSheet); idx = headerIndex(HEADERS); }

  var data = leadSheet.getDataRange().getValues();
  var foundRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx.customer_id]).trim() === String(customerId).trim()) { foundRow = i + 1; break; }
  }
  if (foundRow < 0) { refreshReport(ss); return { result: 'not_found', customer_id: customerId }; }

  var row = leadSheet.getRange(foundRow, 1, 1, HEADERS.length).getValues()[0];
  if (status) row[idx.status] = resolveStatusSimple(status);
  if (paymentAmount !== '' && paymentAmount != null) {
    var n = Number(paymentAmount);
    row[idx.amount] = isNaN(n) ? row[idx.amount] : n;
  }
  var tz = Session.getScriptTimeZone(), now = new Date();
  row[idx.month] = formatMonth(now, tz);
  row[idx.last_updated] = formatDate(now, tz);
  leadSheet.getRange(foundRow, 1, 1, HEADERS.length).setValues([row]);

  // mirror the status change into the service sheet's most recent matching row
  mirrorStatus(ss, customerId, row[idx.service], row[idx.status], typeof row[idx.amount] === 'number' ? row[idx.amount] : null);

  refreshReport(ss);
  return { result: 'updated', customer_id: customerId, status: row[idx.status], payment_amount: row[idx.amount] };
}

// Front-end "Confirm Payment" button posts here:
// POST {customer_id, payment_amount, service}  -> status becomes "Success"
function doPostMarkPaid(e) {
  return safeJson(function () {
    var p = e.parameter || {};
    return markLeadStatus(p.customer_id, 'success', p.payment_amount);
  }, 'mark_paid');
}

// Helper: write the updated status (and amount if provided) to the latest
// service-sheet row that belongs to customerId.
function mirrorStatus(ss, customerId, service, status, amount) {
  var serviceTab = sanitizeSheetName(service);
  var sSheet = ss.getSheetByName(serviceTab);
  if (!sSheet) return;
  var sIdx = headerIndex(sSheet.getRange(1, 1, 1, HEADERS.length).getValues()[0]);
  if (sIdx.customer_id < 0) return;
  var sData = sSheet.getDataRange().getValues();
  for (var j = sData.length - 1; j >= 1; j--) {
    if (String(sData[j][sIdx.customer_id]).trim() === String(customerId).trim()) {
      sData[j][sIdx.status] = status;
      if (amount != null) sData[j][sIdx.amount] = amount;
            sSheet.getRange(j + 1, 1, 1, sData[j].length).setValues([sData[j]]);
      break;
    }
  }
}

/* ====================== REPORT ====================== */

/**
 * Rebuilds the "Report" tab from the master Leads sheet.
 * Shows: Total Revenue + month-wise Pending / Success / Rejected leads
 * (and a bonus per-service breakdown).
 */
function refreshReport(ss) {
  var report = ensureSheet(ss, REPORT_SHEET_NAME, false);
  report.clear();

  var leadSheet = ss.getSheetByName(LEAD_SHEET_NAME);
  var totals = { revenue: 0, pending: 0, success: 0, rejected: 0, leads: 0 };
  var byMonth = {};
  var byService = {};
  var tz = Session.getScriptTimeZone();

  if (leadSheet && leadSheet.getLastRow() > 1) {
    var headers = leadSheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    var idx = headerIndex(headers);
    var rows = leadSheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var status = String(r[idx.status] || '').toLowerCase();
      var amount = Number(r[idx.amount]) || 0;
      var month = String(r[idx.month] || formatMonth(new Date(), tz));
      var service = String(r[idx.service] || 'General Inquiry');

      totals.leads++;
      if (!byMonth[month]) byMonth[month] = { pending: 0, success: 0, rejected: 0, revenue: 0 };
      if (!byService[service]) byService[service] = { leads: 0, pending: 0, success: 0, rejected: 0, revenue: 0 };

      if (status === 'success') {
        totals.success++; totals.revenue += amount;
        byMonth[month].success++; byMonth[month].revenue += amount;
        byService[service].success++; byService[service].revenue += amount;
      } else if (status === 'rejected') {
        totals.rejected++;
        byMonth[month].rejected++;
        byService[service].rejected++;
      } else {
        totals.pending++;
        byMonth[month].pending++;
        byService[service].pending++;
      }
      byService[service].leads++;
    }
  }

  // ---- title ----
  report.getRange('A1').setValue('FairStay Analytics Report').setFontWeight('bold').setFontSize(16);

  // ---- summary ----
  var s = 3;
  report.getRange(s, 1).setValue('Total Revenue');  report.getRange(s, 2).setValue(formatCurrency(totals.revenue));
  report.getRange(s + 1, 1).setValue('Total Leads'); report.getRange(s + 1, 2).setValue(totals.leads);
  report.getRange(s + 2, 1).setValue('Total Pending'); report.getRange(s + 2, 2).setValue(totals.pending);
  report.getRange(s + 3, 1).setValue('Total Success'); report.getRange(s + 3, 2).setValue(totals.success);
  report.getRange(s + 4, 1).setValue('Total Rejected'); report.getRange(s + 4, 2).setValue(totals.rejected);
  report.getRange(s, 1, 5, 1).setFontWeight('bold');
  report.getRange(s, 1, 1, 2).setBackground('#e8f6ef');

  // ---- month-wise table ----
  var m = s + 7;
  report.getRange(m, 1, 1, 5).setValues([['Month', 'Pending Cases', 'Success Leads', 'Rejected Leads', 'Revenue']]);
  report.getRange(m, 1, 1, 5).setFontWeight('bold').setBackground('#e8f6ef');

  var months = Object.keys(byMonth).sort(monthSort);
  var r2 = m + 1;
  months.forEach(function (mk) {
    var x = byMonth[mk];
    report.getRange(r2, 1, 1, 5).setValues([[mk, x.pending, x.success, x.rejected, formatCurrency(x.revenue)]]);
    r2++;
  });
  try { report.getRange(m, 5, Math.max(1, months.length), 1).setNumberFormat('₹#,##0.00'); } catch (err) {}
  try { report.autoResizeColumns(1, 5); } catch (err) {}

  // ---- (bonus) service-wise table ----
  var sv = r2 + 2;
  report.getRange(sv, 1, 1, 6).setValues([['Service', 'Leads', 'Pending', 'Success', 'Rejected', 'Revenue']]);
  report.getRange(sv, 1, 1, 6).setFontWeight('bold').setBackground('#e8f6ef');
  var svRows = SHEET_ORDER();
  var r3 = sv + 1;
  svRows.forEach(function (name) {
    var x = byService[name] || { leads: 0, pending: 0, success: 0, rejected: 0, revenue: 0 };
    report.getRange(r3, 1, 1, 6).setValues([[name, x.leads, x.pending, x.success, x.rejected, formatCurrency(x.revenue)]]);
    r3++;
  });
  try { report.getRange(sv, 6, svRows.length, 1).setNumberFormat('₹#,##0.00'); } catch (err) {}
  try { report.autoResizeColumns(1, 6); } catch (err) {}

  return { result: 'report_refreshed', totals: totals, months: Object.keys(byMonth).length };
}

function SHEET_ORDER() { return ['Rental Agreement', 'Packers & Movers', 'Find Property', 'List Property']; }

// Map a header row to column numbers (0-based).
function headerIndex(headers) {
  var map = {}, out = {};
  for (var i = 0; i < headers.length; i++) {
    map[String(headers[i]).trim().toLowerCase().replace(/[^a-z ]/g, '')] = i;
  }
  function g(label) { return (map[label] != null) ? map[label] : -1; }
  out.timestamp = g('timestamp');
  out.month = g('month');
  out.customer_id = g('customer id');
  out.name = g('name');
  out.phone = g('phone');
  out.email = g('email');
  out.location = g('location');
  out.service = g('service');
  out.details = g('details');
  out.amount = g('payment amount');
  out.status = g('status');
  out.draft_link = g('draft drive link');
  out.request_id = g('request id');
    out.last_updated = g('last updated');
  return out;
}

function formatCurrency(n) {
  if (typeof n !== 'number' || isNaN(n)) n = 0;
  return '₹ ' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function monthSort(a, b) { return monthOrder(a) - monthOrder(b); }
function monthOrder(s) {
  var parts = String(s).split(' ');
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var mi = months.indexOf(parts[0]);
  var yr = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  return yr * 12 + (mi < 0 ? 0 : mi);
}

/* =============== ADMIN: one-click init =============== */

/** Create every service sub-sheet + Leads + Report. Safe to run repeatedly. */
function initializeSheets() {
  var ss = getSpreadsheet();
  ensureSheet(ss, LEAD_SHEET_NAME, true);
  SHEET_ORDER().forEach(function (svc) { ensureSheet(ss, sanitizeSheetName(svc), true); });
  ensureSheet(ss, REPORT_SHEET_NAME, false);
  refreshReport(ss);
  return {
    result: 'initialized',
    sheets: ss.getSheets().map(function (sh) { return sh.getName(); })
  };
}

/* =============== ADMIN (client-callable) wrappers =============== */

/** No-arg refreshReport() that the AdminPage.html can call. */
function webRefreshReport() {
  var ss = getSpreadsheet();
  return refreshReport(ss);
}

/** Returns { spreadsheet_id, sheets[] } for the admin page. */
function getAdminInfo() {
  var ss = getSpreadsheet();
  return {
    spreadsheet_id: ss.getId(),
    sheets: ss.getSheets().map(function (sh) { return sh.getName(); })
  };
}

/** Convenience: POST {action:'refresh'} (or a browser GET ?action=refresh) */
function doPostRefreshReport(e) {
  return safeJson(function () { return webRefreshReport(); }, 'refresh');
}

/** POST {action:'initialize'} */
function doPostInitialize(e) {
  return safeJson(function () { return initializeSheets(); }, 'initialize');
}

