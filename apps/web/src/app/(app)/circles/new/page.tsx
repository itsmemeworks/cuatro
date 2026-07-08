import { CreateCircleForm } from "@/components/circles/create-circle-form";

export default function NewCirclePage() {
  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New Circle</h1>
      <CreateCircleForm />
    </main>
  );
}
