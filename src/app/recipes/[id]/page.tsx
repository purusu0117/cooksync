import RecipeDetail from "@/components/recipes/RecipeDetail";

// Next.js 16: params は Promise なので await する
export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RecipeDetail id={id} />;
}
