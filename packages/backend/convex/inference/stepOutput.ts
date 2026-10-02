/**
 * Holds text until we know whether the step was a user-facing answer or merely
 * narration emitted before a tool call. Used for thinking-enabled turns, where
 * provider scratch work must stay in the dedicated reasoning phase.
 *
 * The only signals here are structural — did this step call a tool, and what
 * did the provider say ended it. Content is never inspected: what a reply may
 * and may not say is the system prompt's job (see prompts.ts and
 * toolPolicy.ts). Pattern-matching the text was tried and it kept destroying
 * finished, honest replies over words they were entitled to use.
 */
export class StepOutputBuffer {
  private value = "";
  private usedTool = false;

  start() {
    this.value = "";
    this.usedTool = false;
  }

  add(delta: string) {
    this.value += delta;
  }

  markToolCall() {
    this.usedTool = true;
  }

  /**
   * A step's text is user-facing only when the step actually ended the reply.
   * `finishReason` is the provider's own verdict, so a step that ended on tool
   * calls drops its text even if the SDK rejected the calls without surfacing
   * any tool events for us to mark.
   */
  finish(finishReason?: string): string {
    const value = this.value;
    const usedTool = this.usedTool;
    this.start();

    if (!value || usedTool || finishReason === "tool-calls") return "";
    return value;
  }
}
