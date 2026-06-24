// Temporäre Diagnose-Function — nur im develop-Branch
exports.handler = async () => {
  const sheetId = process.env.GOOGLE_SHEET_ID || 'NICHT GESETZT';
  // Nur die letzten 6 Zeichen zeigen (Sicherheit)
  const preview = sheetId.length > 6 ? '...' + sheetId.slice(-6) : sheetId;
  return {
    statusCode: 200,
    body: JSON.stringify({ sheet_id_preview: preview, env: process.env.CONTEXT || 'unbekannt' })
  };
};
