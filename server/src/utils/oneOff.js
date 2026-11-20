// One-offs sit below the line on every P&L (owner, 2026-11-20): the net is shown before them, then
// them, then the net. They are the `One-Off Items` forecast line and the category of the same name
// (Property One-Off, Car Purchase/Sale, Tax Adjustment). Matched by name, tolerant of the spelling:
// "One-Off Items", "One-off items", "Oneoff".
const isOneOffName = (name) => /\bone[\s-]?off\b/i.test(String(name || ''));

module.exports = { isOneOffName };
