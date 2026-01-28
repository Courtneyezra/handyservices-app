import React from "react";

export const SectionWrapper = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
    <section className={`min-h-[80vh] flex flex-col items-center justify-center p-6 text-center relative overflow-hidden ${className}`}>
        {children}
    </section>
);
