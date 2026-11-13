"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Company detail sections (PR #11 UI spec UI-02: Overview | Access & controls | Users |
// Subscription | Activity). The panels are rendered on the server and passed in, so switching tabs
// is client-only: it neither re-reads the company nor writes another audit record. The shared Radix
// tabs give the keyboard model (arrow keys follow the document direction, so they mirror in Arabic).
export type CompanyTabValue = "overview" | "access" | "users" | "subscription" | "activity";

export function CompanyTabs({ label, initial, tabs }: { label: string; initial: CompanyTabValue; tabs: { value: CompanyTabValue; label: string; content: React.ReactNode }[] }) {
  return (
    <Tabs defaultValue={initial} className="platform-company-tabs">
      <TabsList aria-label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
