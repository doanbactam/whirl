import Image from "next/image";

/* The three portraits the model is handed, fanned like a hand of cards.
   Decorative: the drop zone shows them so the visitor knows whose face is
   about to turn up. Through next/image so the page ships 56px thumbnails,
   not the 640px files the model gets; `priority` because they're the first
   thing above the fold. */

const PORTRAITS = [
  { src: "/kirkify/reference-1.jpg", tilt: "-rotate-6 translate-y-1" },
  { src: "/kirkify/reference-3.jpg", tilt: "z-10" },
  { src: "/kirkify/reference-2.jpg", tilt: "rotate-6 translate-y-1" },
] as const;

export function ReferenceFan() {
  return (
    <div aria-hidden className="flex items-end -space-x-3">
      {PORTRAITS.map(({ src, tilt }) => (
        <Image
          key={src}
          src={src}
          alt=""
          width={56}
          height={72}
          priority
          draggable={false}
          className={`h-[72px] w-14 rounded-xl object-cover ring-2 ring-white dark:ring-[#161615] ${tilt}`}
        />
      ))}
    </div>
  );
}
