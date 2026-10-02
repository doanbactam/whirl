import { Spinner } from "~/components/spinner";

export function LoadingScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F3F3F3] dark:bg-[#141414]">
      <Spinner size={20} className="text-blue-500" />
    </div>
  );
}
