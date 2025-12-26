import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, MapPin } from "lucide-react";

const FIRST_NAMES = [
  "James", "Emma", "Oliver", "Sophie", "Harry", "Olivia", "Jack", "Emily",
  "Charlie", "Grace", "Thomas", "Mia", "George", "Chloe", "William", "Lily",
  "Henry", "Ella", "Oscar", "Hannah", "Daniel", "Sarah", "Alexander", "Lucy",
  "Michael", "Katie", "David", "Rachel", "Ben", "Jessica", "Sam", "Laura"
];

const NOTTINGHAM_LOCATIONS = [
  "Nottingham", "West Bridgford", "Arnold", "Beeston", "Long Eaton",
  "Stapleford", "Sandiacre", "Eastwood", "Hucknall", "Carlton",
  "Mapperley", "Sherwood", "Bulwell", "Gedling", "Netherfield"
];

const DERBY_LOCATIONS = [
  "Derby", "Mickleover", "Littleover", "Chellaston", "Allestree",
  "Spondon", "Borrowash", "Ilkeston", "Belper", "Ripley",
  "Heanor", "Burton", "Duffield", "Mackworth", "Darley Abbey"
];

const JOBS = [
  { task: "TV mounting", price: "£65-95" },
  { task: "shelf installation", price: "£45-75" },
  { task: "blind fitting", price: "£55-85" },
  { task: "picture hanging", price: "£35-55" },
  { task: "curtain rail fitting", price: "£50-80" },
  { task: "mirror mounting", price: "£45-70" },
  { task: "flat pack assembly", price: "£60-120" },
  { task: "door repair", price: "£75-120" },
  { task: "lock replacement", price: "£65-95" },
  { task: "bathroom repairs", price: "£80-150" },
  { task: "tap replacement", price: "£70-110" },
  { task: "painting touch-up", price: "£55-90" },
  { task: "fence panel repair", price: "£85-140" },
  { task: "gate fixing", price: "£70-120" },
  { task: "kitchen cabinet repair", price: "£60-100" }
];

function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function getTimeAgo(): string {
  const minutes = Math.floor(Math.random() * 12) + 1;
  return minutes === 1 ? "1 min ago" : `${minutes} mins ago`;
}

interface Notification {
  id: string;
  name: string;
  location: string;
  task: string;
  price: string;
  timeAgo: string;
}

function generateNotification(locations: string[]): Notification {
  const job = getRandomItem(JOBS);
  return {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: getRandomItem(FIRST_NAMES),
    location: getRandomItem(locations),
    task: job.task,
    price: job.price,
    timeAgo: getTimeAgo()
  };
}

interface SocialProofSectionProps {
  location?: 'nottingham' | 'derby';
}

export function SocialProofSection({ location = 'nottingham' }: SocialProofSectionProps) {
  const locations = location === 'derby' ? DERBY_LOCATIONS : NOTTINGHAM_LOCATIONS;

  const [notifications, setNotifications] = useState<Notification[]>(() => [
    generateNotification(locations),
    generateNotification(locations),
    generateNotification(locations)
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNotifications(prev => {
        const newNotification = generateNotification(locations);
        return [...prev.slice(1), newNotification];
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [locations]);

  return (
    <section className="py-8 px-4 bg-slate-800 overflow-hidden font-poppins" data-testid="social-proof-section">
      <div className="max-w-4xl mx-auto">
        <h3 className="text-center text-sm font-medium text-amber-400 mb-4">
          Recent quotes in your area
        </h3>
        <div className="flex flex-col md:flex-row gap-4">
          <AnimatePresence mode="popLayout" initial={false}>
            {notifications.map((notification, idx) => (
              <motion.div
                key={notification.id}
                layout
                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -30, scale: 0.9 }}
                transition={{
                  type: "spring",
                  stiffness: 300,
                  damping: 25
                }}
                className="flex-1 bg-slate-700/50 rounded-xl border border-slate-600 p-4 flex items-start gap-3"
                data-testid={`social-proof-card-${idx}`}
              >
                <div className="flex-shrink-0 w-10 h-10 bg-amber-400/20 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {notification.name} got a quote
                  </p>
                  <p className="text-sm text-white/70 mt-0.5">
                    {notification.task} • <span className="font-medium text-amber-400">{notification.price}</span>
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <MapPin className="w-3 h-3 text-white/40" />
                    <span className="text-xs text-white/40">{notification.location} • {notification.timeAgo}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
