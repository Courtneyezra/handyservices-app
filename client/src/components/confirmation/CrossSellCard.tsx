import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, ArrowRight } from 'lucide-react';
import {
  getRecommendedServices,
  getCrossSellCardContent,
  type CrossSellService,
} from '@/lib/cross-sell-recommendations';

interface CrossSellCardProps {
  jobDescription: string;
  segment: string;
  onRequestService: (service: CrossSellService) => void;
  onViewAllServices: () => void;
}

export function CrossSellCard({
  jobDescription,
  segment,
  onRequestService,
  onViewAllServices,
}: CrossSellCardProps) {
  const recommendations = getRecommendedServices(jobDescription, segment, 3);
  const content = getCrossSellCardContent(segment);

  // Don't show card if no recommendations
  if (recommendations.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 }}
    >
      <Card className="bg-white border-handy-grid shadow-sm">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-handy-navy mb-1">{content.header}</h3>
          <p className="text-handy-muted text-sm mb-4">{content.subheader}</p>

          {/* Service cards */}
          <div className="space-y-3 mb-4">
            {recommendations.map((service, index) => (
              <motion.div
                key={service.skuCode}
                className="flex items-center justify-between p-3 bg-handy-bg rounded-lg border border-handy-grid hover:border-handy-yellow/50 transition-colors"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 + index * 0.1 }}
              >
                <div className="flex-1">
                  <h4 className="font-medium text-handy-navy text-sm">{service.name}</h4>
                  <p className="text-xs text-handy-muted">{service.description}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-handy-navy hover:bg-handy-yellow/20"
                  onClick={() => onRequestService(service)}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </motion.div>
            ))}
          </div>

          {/* See all services link */}
          <Button
            variant="link"
            className="w-full text-handy-navy hover:text-handy-yellow"
            onClick={onViewAllServices}
          >
            View All Services
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>

          {/* No pressure note */}
          <p className="text-xs text-center text-handy-muted mt-2">
            Add now or request later, no pressure
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
