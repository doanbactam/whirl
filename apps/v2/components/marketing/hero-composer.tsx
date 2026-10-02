"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { stashComposerPrefill } from "@/lib/composer-prefill";
import { useModelPref } from "@/lib/model-pref";
import { Composer } from "@/components/composer";

export function HeroComposer() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [model, setModel] = useModelPref();

  const enterWhirl = (prompt: string) => {
    if (prompt) stashComposerPrefill(prompt);
    router.push("/");
  };

  return (
    <Composer
      value={value}
      onValueChange={setValue}
      model={model}
      onModelChange={setModel}
      onSubmit={(prompt) => enterWhirl(prompt)}
    />
  );
}
