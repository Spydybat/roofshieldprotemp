import { createFileRoute } from "@tanstack/react-router";
import HomeExperience from "@/components/HomeExperience";

/**
 * Whop b2c_app community experience entry route.
 * Matches app_S6fj7hfqepepH7's configured experience_path: /experiences/[experienceId].
 */
export const Route = createFileRoute("/experiences/$experienceId")({
  component: HomeExperience,
});
