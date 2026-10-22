import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, like, notLike } from "drizzle-orm";
import { Anton, Cairo, Montserrat, Playfair_Display } from "next/font/google";
import { db } from "@/db";
import { marketingAssets, marketingCampaigns } from "@/db/schema";
import { PosterEditor } from "@/components/marketing/PosterEditor";
import { PageHeader } from "@/components/ui";
import { requirePageAuth } from "@/lib/page-auth";
import { loadPosterProducts } from "@/lib/marketing";
import { normalizeDesign, UPLOAD_PREFIX, type PosterDesign } from "@/lib/poster";
import { AI_SCENES_PER_DAY, AMBIANCES, aiScenesConfigured } from "@/lib/ai-scenes";

export const metadata = { title: "Affiche" };
// Server actions of this page include AI scene generation (about 10 s).
export const maxDuration = 60;

// Poster typography: Montserrat (Latin, like NUMEDIA's posters), Cairo (Arabic + Latin digits),
// Anton (condensed display, flash/podium styles) and Playfair Display (editorial style).
const montserrat = Montserrat({ subsets: ["latin"], weight: ["500", "600", "800", "900"], display: "block", variable: "--font-poster-latin" });
const cairo = Cairo({ subsets: ["arabic", "latin"], weight: ["500", "600", "800", "900"], display: "block", variable: "--font-poster-arabic" });
const anton = Anton({ subsets: ["latin"], weight: "400", display: "block", variable: "--font-poster-display" });
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600", "700", "800", "900"], display: "block", variable: "--font-poster-serif" });

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePageAuth();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [campaign] = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.workspaceId, auth.workspace.id)))
    .limit(1);
  if (!campaign) notFound();
  const products = await loadPosterProducts(auth.workspace.id, campaign.productIds);
  const generated = await db
    .select({ id: marketingAssets.id })
    .from(marketingAssets)
    .where(and(eq(marketingAssets.workspaceId, auth.workspace.id), eq(marketingAssets.campaignId, campaign.id), notLike(marketingAssets.prompt, `${UPLOAD_PREFIX}%`)))
    .orderBy(desc(marketingAssets.createdAt))
    .limit(20);
  // Pictures uploaded in the studio, reusable on every poster of the workspace.
  const uploads = await db
    .select({ id: marketingAssets.id, prompt: marketingAssets.prompt })
    .from(marketingAssets)
    .where(and(eq(marketingAssets.workspaceId, auth.workspace.id), like(marketingAssets.prompt, `${UPLOAD_PREFIX}%`)))
    .orderBy(desc(marketingAssets.createdAt))
    .limit(60);

  return (
    // The font variables make Next load both families (the UI keeps its own font); the canvas draws with them.
    <div className={`${montserrat.variable} ${cairo.variable} ${anton.variable} ${playfair.variable}`}>
      <PageHeader
        title={campaign.name}
        subtitle="Composez librement : calques, images, textes et formes, chaque élément se déplace, se redimensionne et pivote. Les prix et les photos produit viennent du catalogue ; validez pour débloquer le téléchargement."
        actions={
          <Link href="/marketing" className="h-10 rounded-lg border border-[#d7e3e6] bg-white px-4 text-sm leading-10 text-[#0b4a56]">
            Retour au studio
          </Link>
        }
      />
      <PosterEditor
        campaign={{
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          validatedAt: campaign.validatedAt ? campaign.validatedAt.toISOString() : null,
          design: normalizeDesign(campaign.design as Partial<PosterDesign>, products),
          versions: campaign.versions.map((v) => ({ at: v.at, design: normalizeDesign(v.design as Partial<PosterDesign>, products) })),
        }}
        initialProducts={products}
        uploads={uploads.map((u) => ({ id: u.id, url: `/api/marketing/image?asset=${u.id}`, name: u.prompt.slice(UPLOAD_PREFIX.length) }))}
        fonts={{ latin: montserrat.style.fontFamily, arabic: cairo.style.fontFamily, display: anton.style.fontFamily, serif: playfair.style.fontFamily }}
        ai={{
          enabled: aiScenesConfigured(),
          perDay: AI_SCENES_PER_DAY,
          ambiances: AMBIANCES.map(({ id, label }) => ({ id, label })),
          generated: generated.map((g) => {
            const url = `/api/marketing/image?asset=${g.id}`;
            return { url, thumb: url, title: "Scène IA", creator: "Image générée par IA (FLUX.1 schnell, Cloudflare)", landing: "" };
          }),
        }}
      />
    </div>
  );
}
