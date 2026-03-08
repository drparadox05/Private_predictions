import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-3xl px-6 py-24 lg:px-8">
      <Panel className="w-full p-10 text-center">
        <p className="text-xs uppercase tracking-[0.32em] text-cyan/70">404</p>
        <h1 className="mt-3 text-4xl font-semibold text-white">Signal not found</h1>
        <p className="mt-4 text-sm leading-7 text-slate-400">
          The requested market or route does not exist in the current interface.
        </p>
        <Link href="/app" className="mt-8 inline-flex">
          <Button>Back to dashboard</Button>
        </Link>
      </Panel>
    </div>
  );
}
