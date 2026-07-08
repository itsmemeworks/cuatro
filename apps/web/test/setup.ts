import { __setRealtimeSenderForTests } from "@/lib/realtime/broadcast";

// Suite-wide default: every server/*.ts mutation now fires a realtime
// broadcast after its transaction commits (see src/lib/realtime/broadcast.ts).
// Most tests exercise a mutation for its DB effect and have no Supabase env
// configured, so without this they'd all hit the real sender's "env not
// configured" failure path — harmless (emitRealtime swallows it) but noisy.
// Tests that specifically want to assert on broadcasts install their own spy
// via __setRealtimeSenderForTests and should restore this default afterward.
__setRealtimeSenderForTests(null);
