/**
 * Serialises expensive template renders. A renderer is never run concurrently:
 * while it is working, only the newest source is retained for the next run.
 */
export class TemplatePreviewQueue {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private latestSource: string | undefined;
  private stopped = false;

  constructor(
    private readonly render: (source: string) => Promise<void>,
    private readonly delay = 700,
  ) {}

  schedule(source: string) {
    if (this.stopped) return;
    this.latestSource = source;
    if (this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, this.delay);
  }

  retry(source: string) {
    if (this.stopped) return;
    this.latestSource = source;
    if (this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    void this.run();
  }

  private async run() {
    if (this.stopped || this.active) return;
    const source = this.latestSource;
    this.latestSource = undefined;
    if (!source?.trim()) return;
    this.active = true;
    try {
      await this.render(source);
    } catch {
      // Render failures are reported by the UI callback. Keep this queue alive
      // so a later edit or retry can still render.
    } finally {
      this.active = false;
      if (!this.stopped && this.latestSource !== undefined) void this.run();
    }
  }

  destroy() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.latestSource = undefined;
  }
}

export function isTemplateEditorDirty(
  initial: { name: string; source: string },
  current: { name: string; source: string },
) {
  return initial.name !== current.name || initial.source !== current.source;
}
