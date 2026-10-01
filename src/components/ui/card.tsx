import * as React from "react";
import { cn } from "@/lib/utils";

// Navy Command card foundation (DEV-UI-01.1): the literal `.card` class (mockup-parity.css) is now an
// 8px, border-led, solid surface with no default shadow and no hover lift. `hoverable` is accepted for
// compatibility and deliberately does nothing — a universal hover lift is not part of the design.
function Card({ className, hoverable, ...props }: React.ComponentProps<"div"> & { hoverable?: boolean }) {
  void hoverable;
  return <div data-slot="card" className={cn("card", className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1 px-5 pt-5", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-title-sm font-semibold text-ink", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-xs text-ink-muted", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-5 pb-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-5 pb-5", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
