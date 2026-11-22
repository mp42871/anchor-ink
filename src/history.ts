import type { Annotation } from './types';

export interface Op {
  page: number;
  before: Annotation[];
  after: Annotation[];
}

/** Snapshot-per-page undo history. Annotations are immutable, so snapshots are cheap. */
export class History {
  private undoStack: Op[] = [];
  private redoStack: Op[] = [];
  constructor(private apply: (page: number, anns: Annotation[]) => void, private onChange: () => void) {}

  push(page: number, before: Annotation[], after: Annotation[]) {
    this.undoStack.push({ page, before: before.slice(), after: after.slice() });
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this.onChange();
  }
  undo() {
    const op = this.undoStack.pop();
    if (!op) return;
    this.redoStack.push(op);
    this.apply(op.page, op.before.slice());
    this.onChange();
    return op.page;
  }
  redo() {
    const op = this.redoStack.pop();
    if (!op) return;
    this.undoStack.push(op);
    this.apply(op.page, op.after.slice());
    this.onChange();
    return op.page;
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange();
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
