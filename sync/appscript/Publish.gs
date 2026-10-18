/**
 * Publish a file to the GitHub repo via the Contents API, so a time-driven
 * trigger can push stock.json straight into the site — no manual commit.
 *
 * Script Properties:
 *   GH_TOKEN  = fine-grained PAT  (Contents: Read and write, only this repo)
 *   GH_REPO   = icyice1998/thaical
 *   GH_BRANCH = main              (the branch GitHub Pages serves)
 *   GH_PATH   = data/stock.json
 *
 * Run exportStockJson() first (it writes stock.json to Drive), then this.
 * Or chain both from a single trigger with exportAndPublish().
 */
function publishStockJson() {
  var p = PropertiesService.getScriptProperties();
  var it = DriveApp.getFilesByName('stock.json');
  if (!it.hasNext()) throw new Error('No stock.json in Drive — run exportStockJson() first.');
  var content = it.next().getBlob().getDataAsString('UTF-8');
  return publishToGitHub_(p.getProperty('GH_PATH') || 'data/stock.json', content, 'stock update');
}

/** One trigger target: refresh price+stock, then push to GitHub. */
function exportAndPublish() {
  exportStockJson();
  publishStockJson();
}

function publishToGitHub_(path, content, message) {
  var p = PropertiesService.getScriptProperties();
  var repo = p.getProperty('GH_REPO');
  var branch = p.getProperty('GH_BRANCH') || 'main';
  var token = p.getProperty('GH_TOKEN');
  if (!repo || !token) throw new Error('Set GH_REPO and GH_TOKEN in Script Properties.');

  var base = 'https://api.github.com/repos/' + repo + '/contents/' + path;
  var headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };

  // Look up the current file SHA (required to update an existing file).
  var sha = null;
  var get = UrlFetchApp.fetch(base + '?ref=' + encodeURIComponent(branch),
            { method: 'get', headers: headers, muteHttpExceptions: true });
  if (get.getResponseCode() === 200) sha = JSON.parse(get.getContentText()).sha;

  var payload = {
    message: message + ' ' + new Date().toISOString(),
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: branch
  };
  if (sha) payload.sha = sha;

  var put = UrlFetchApp.fetch(base, {
    method: 'put', headers: headers, contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = put.getResponseCode();
  Logger.log('GitHub ' + code + ': ' + put.getContentText().slice(0, 200));
  if (code >= 300) throw new Error('GitHub publish failed (' + code + ')');
  return code;
}
