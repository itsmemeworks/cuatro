"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

/**
 * The default submit for any `<form action={fn}>`: while the action is
 * in flight it shows Button's pending spinner, sets aria-busy, and blocks
 * the double-click double-submit (Pete, 2026-07-11: a click with no visible
 * response reads as "nothing happened"). Must render INSIDE the form —
 * useFormStatus reads the nearest parent form's status and returns
 * pending=false anywhere else, which fails silent; there is no warning.
 */
export function SubmitButton({ type = "submit", pending, ...props }: ButtonProps) {
  const status = useFormStatus();
  return <Button type={type} pending={pending || status.pending} {...props} />;
}
