**Status:** COMPLETED — [Plan](../NEXT_STEPS.md#cr010)

# CR010 — COA Management Redesign + Move Feature

Tree-view COA editor with horizontal toolbar, inline row actions, quick-add for missing accounts/categories, and a move feature for re-parenting accounts under any node.

## Outcome

- Page rewrite: `/coa-management` (`COAManagement.jsx`).
- Tree view (`COATreeTable.jsx`, `COATreeRow.jsx`) with expand/collapse chevrons.
- Horizontal toolbar (`COAManagementToolbar.jsx`) replaces sidebar filter panel.
- Inline row actions on hover: edit, delete, add child, move.
- "Add as category" toggle in the Add modal so categories can be created at any point in the hierarchy.
- Quick-add for missing accounts (green +) and missing categories (blue +) discovered by PS Analyze.
- **Move feature:** `COAMoveModal.jsx` with full-tree picker; uses `POST /api/v2/util/coa/add` which re-parents an existing account when found under a different parent.
- `COACategoryPicker.jsx` accepts `includeAllNodes` and `excludeName` props.
- Account type display capitalized in tree, edit modal dropdown, toolbar filter (DB values stay lowercase for compatibility).

## Key references

- Components: `frontend/src/features/COAManagement/`.
- Backend endpoints: `POST /api/v2/util/coa/add`, `POST /api/v2/util/coa/update`, `POST /api/v2/util/coa/delete`.

## Related

After CR013 collapsed the categories table into accounts, the "Add as category" toggle is now purely a UI hint about hierarchy intent (a category is just a non-leaf account); no separate write to a categories table.
