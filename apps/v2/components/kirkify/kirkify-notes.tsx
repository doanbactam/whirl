import { IconClockFilled, IconLockFilled } from "@tabler/icons-react";

import { BentoCell, BentoGrid } from "@/components/marketing/bento";

export function KirkifyNotes() {
  return (
    <BentoGrid columns={2}>
      <BentoCell
        icon={IconClockFilled}
        title="Three a day, free"
        body="Every visitor gets three a day. Sign in for five more. Paid plans draw on their usage instead, with no daily count."
      />
      <BentoCell
        icon={IconLockFilled}
        title="Nothing kept"
        body="Your photo goes to the model and the result comes straight back. Whirl stores neither."
      />
    </BentoGrid>
  );
}
