"use client";

import { useState } from "react";
import FxConverter from "@/components/FxConverter";
import AccountActivity from "@/components/AccountActivity";

export default function AccountActivitySection() {
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <FxConverter onConverted={() => setRefreshSignal((n) => n + 1)} />
      <AccountActivity refreshSignal={refreshSignal} />
    </div>
  );
}
