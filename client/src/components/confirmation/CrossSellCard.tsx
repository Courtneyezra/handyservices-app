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
      <Card className="bg-gray-800/60 border-gray-700">
        <CardContent className="p-6">
          <h3 className="text-lg font-semibold text-white mb-1">{content.header}</h3>
          <p className="text-gray-400 text-sm mb-4">{content.subheader}</p>

          {/* Service cards */}
          <div className="space-y-3 mb-4">
            {recommendations.map((service, index) => (
              <motion.div
                key={service.skuCode}
                className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg border border-gray-600 hover:border-[#e8b323]/50 transition-colors"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.7 + index * 0.1 }}
              >
                <div className="flex-1">
                  <h4 className="font-medium text-white text-sm">{service.name}</h4>
                  <p className="text-xs text-gray-400">{service.description}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[#e8b323] hover:bg-[#e8b323]/20"
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
            className="w-full text-gray-400 hover:text-[#e8b323]"
            onClick={onViewAllServices}
          >
            View All Services
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>

          {/* No pressure note */}
          <p className="text-xs text-center text-gray-500 mt-2">
            Add now or request later - no pressure
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
