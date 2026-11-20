import { createFileRoute } from "@tanstack/react-router";
import HomeExperience from "@/components/HomeExperience";

export const Route = createFileRoute("/discover")({
  component: HomeExperience,
});
