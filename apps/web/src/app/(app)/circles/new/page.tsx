import { CreateCircleForm } from "@/components/circles/create-circle-form";

export default function NewCirclePage() {
  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div>
        <h1 className="text-cu-title text-ink">Make it yours</h1>
        <p className="text-cu-secondary text-ink-muted mt-1">every Circle gets a colour and a mark</p>
      </div>
      <CreateCircleForm />
    </main>
  );
}
