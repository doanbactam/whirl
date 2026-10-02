import { generateText } from "ai";

import { createOpenRouterChatModel } from "@whirl/backend/convex/inference/billing";
import { messageContentForModel } from "@whirl/backend/convex/inference/attachments";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("Missing OPENROUTER_API_KEY (pass via --env-file=.env.local)");
  process.exit(1);
}

const attachmentText =
  "# pasted snippet\n\nThe secret codeword is **pineapple-junction**.";

const content = messageContentForModel({
  role: "user",
  content: "What is the secret codeword in the attached file? Reply with just the codeword.",
  attachments: [
    {
      name: "pasted-text.md",
      size: attachmentText.length,
      type: "text/markdown",
      text: attachmentText,
    },
  ],
});

if (typeof content === "string") {
  console.error("Expected multipart content, got string");
  process.exit(1);
}

const hasFileBlock = content.some((part) => part.type === "file");
if (hasFileBlock) {
  console.error("FAIL: text attachment was converted to a file block");
  console.error(JSON.stringify(content, null, 2));
  process.exit(1);
}

console.log("messageContentForModel: ok (inline text, no file block)");

const model = createOpenRouterChatModel({ apiKey, modelKey: "Max" });
const result = await generateText({
  model,
  messages: [{ role: "user", content }],
  maxOutputTokens: 32,
});

const answer = result.text.trim().toLowerCase();
console.log("model reply:", result.text.trim());

if (!answer.includes("pineapple-junction")) {
  console.error("FAIL: model did not read the attached text");
  process.exit(1);
}

console.log("openrouter Max: ok");
