/** Shared limit for the editor's undo AND redo history. */
export const STANDARD_UNDO_LIMIT = 5;
export const EXTENDED_UNDO_LIMIT = 20;

// EXTRA UNDOS: change false to true to enable the 20-step history.
// Change it back to false for the standard 5-step history.
// This is a code switch only; connect it to paid-plan entitlements later.
export const ENABLE_EXTENDED_UNDO = false;

export const UNDO_LIMIT = ENABLE_EXTENDED_UNDO
  ? EXTENDED_UNDO_LIMIT
  : STANDARD_UNDO_LIMIT;
