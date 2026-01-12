
import { useParams } from "wouter";
import { useLandingPage } from "../hooks/useLandingPage";
import { Button } from "../components/ui/button";

export default function LandingPageRender() {
    const { slug } = useParams();
    const { variant, isLoading, error, trackConversion } = useLandingPage(slug!);

    if (isLoading) return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    if (error || !variant) return <div className="flex items-center justify-center min-h-screen">Page not found</div>;

    const { content } = variant;

    return (
        <div className="min-h-screen bg-background">
            {/* Hero Section */}
            <header className="relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-background z-0" />
                <div className="container mx-auto px-4 py-24 relative z-10 grid md:grid-cols-2 gap-12 items-center">
                    <div className="space-y-6">
                        <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-[1.1]">
                            {content.heroHeadline}
                        </h1>
                        <p className="text-xl text-muted-foreground">
                            {content.heroSubhead}
                        </p>
                        <div className="pt-4">
                            <Button size="lg" className="text-lg px-8 py-6 h-auto shadow-xl shadow-primary/20 hover:scale-105 transition-transform" onClick={trackConversion}>
                                {content.ctaText || "Get Started"}
                            </Button>
                        </div>
                    </div>
                    <div>
                        {content.heroImage ? (
                            <img src={content.heroImage} alt="Hero" className="rounded-xl shadow-2xl border bg-card" />
                        ) : (
                            <div className="aspect-video bg-muted rounded-xl flex items-center justify-center text-muted-foreground border-2 border-dashed">
                                Image Placeholder
                            </div>
                        )}
                    </div>
                </div>
            </header>

            {/* Content Body (Simple JSON render for now or expand for more blocks) */}
            <main className="container mx-auto px-4 py-16">
                {/*  This template is currently fixed as 'Hero Only' + 'Standard Footer' effectively. 
                      Future work: Add 'blocks' array to content JSON. 
                  */}
                <div className="max-w-3xl mx-auto prose dark:prose-invert">
                    {/* If we had body content, render here */}
                </div>
            </main>
        </div>
    );
}
