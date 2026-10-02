import { jsonSchema, tool } from "ai";

export const ASK_QUESTION_TOOL_NAME = "askUserQuestion";

/** One step of the form, exactly as it lands on the message's `question` phase. */
export type QuestionSpec = {
  id: string;
  prompt: string;
  /** Short chip label shown on the step ("Approach", "Colors"). */
  header?: string;
  type: "single" | "multi" | "text" | "attachment";
  options?: { label: string; description?: string }[];
  /** Choice steps grow a "something else…" free-text row. Defaults on. */
  allowOther?: boolean;
  placeholder?: string;
};

export type QuestionPhasePayload = { questions: QuestionSpec[] };

type AskUserQuestionInput = {
  questions: {
    question: string;
    header?: string;
    type?: "single" | "multi" | "text" | "attachment";
    options?: { label: string; description?: string }[];
    allowOther?: boolean;
    placeholder?: string;
  }[];
};

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 6;

/**
 * Raises an interactive form in the user's composer: single choice (radio),
 * multiple choice (checkboxes), a short text field, or a file request — one
 * step per question, answered together and returned as the user's next
 * message. The tool itself only validates + persists the question spec; the
 * turn is expected to end right after (prepareStep cuts tools once a form is
 * up) so the user is never answering a moving target.
 */
export function createAskUserQuestionTool({
  onResult,
}: {
  onResult: (payload: QuestionPhasePayload) => Promise<void>;
}) {
  return tool({
    description:
      "Ask the user up to 4 questions through an interactive form (single choice, multiple choice, short text, or a file request). Use it only when their input genuinely changes what you do next.",
    inputSchema: jsonSchema<AskUserQuestionInput>({
      type: "object",
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          maxItems: MAX_QUESTIONS,
          description:
            "The questions to ask, each rendered as one step of the form.",
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                maxLength: 200,
                description: "The full question, ending with a question mark.",
              },
              header: {
                type: "string",
                maxLength: 24,
                description:
                  "Very short topic label for the step ('Approach', 'Colors').",
              },
              type: {
                type: "string",
                enum: ["single", "multi", "text", "attachment"],
                description:
                  "single = pick one option, multi = pick any number, text = short free-text answer, attachment = ask the user to attach files.",
              },
              options: {
                type: "array",
                minItems: 2,
                maxItems: MAX_OPTIONS,
                description:
                  "Choices for single/multi questions. 2-6 distinct options; never add an 'other' option yourself — the form provides one.",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      maxLength: 80,
                      description: "Concise choice text (1-6 words).",
                    },
                    description: {
                      type: "string",
                      maxLength: 120,
                      description:
                        "Optional one-line clarification or trade-off.",
                    },
                  },
                  required: ["label"],
                  additionalProperties: false,
                },
              },
              allowOther: {
                type: "boolean",
                description:
                  "Whether choice questions offer a 'something else' free-text row. Defaults to true.",
              },
              placeholder: {
                type: "string",
                maxLength: 60,
                description: "Placeholder for text questions.",
              },
            },
            required: ["question"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    }),
    execute: async ({ questions }) => {
      const normalized: QuestionSpec[] = [];
      for (const raw of questions.slice(0, MAX_QUESTIONS)) {
        const prompt = raw.question?.trim();
        if (!prompt) continue;
        const options = (raw.options ?? [])
          .map((option) => {
            const label = option.label?.trim();
            const description = option.description?.trim();
            return label
              ? { label, ...(description ? { description } : {}) }
              : null;
          })
          .filter((option): option is { label: string } => option !== null)
          .slice(0, MAX_OPTIONS);
        // A choice question with fewer than two real options isn't a choice —
        // degrade it to a text step instead of showing a one-button "poll".
        const requested = raw.type ?? (options.length >= 2 ? "single" : "text");
        const type =
          (requested === "single" || requested === "multi") &&
          options.length < 2
            ? "text"
            : requested;
        const header = raw.header?.trim();
        const placeholder = raw.placeholder?.trim();
        normalized.push({
          id: `q${normalized.length + 1}`,
          prompt,
          ...(header ? { header } : {}),
          type,
          ...(type === "single" || type === "multi"
            ? { options, allowOther: raw.allowOther !== false }
            : {}),
          ...(type === "text" && placeholder ? { placeholder } : {}),
        });
      }

      // Settle the pending phase either way so the chip never dangles; an
      // empty payload drops it (nothing renderable was asked).
      await onResult({ questions: normalized });

      if (normalized.length === 0) {
        return "No usable questions were provided, so nothing was shown. Ask in plain prose instead.";
      }

      return {
        formShown: normalized.map(({ prompt, type }) => ({ prompt, type })),
        note: "The form is on the user's screen now. End your turn with at most one short sentence (or nothing) — do not repeat the questions in prose or answer them yourself. The user's answers will arrive as their next message.",
      };
    },
  });
}
