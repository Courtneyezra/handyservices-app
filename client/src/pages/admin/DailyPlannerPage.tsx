import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  format,
  parseISO,
  startOfWeek,
  addWeeks,
  eachDayOfInterval,
  addDays,
  isToday,
  isTomorrow,
} from "date-fns";
import {
  Loader2,
  Calendar,
  Clock,
  MapPin,
  Truck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  PoundSterling,
  Users,
  ChevronDown,
  ChevronUp,
  Send,
  AlertTriangle,
} from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WeekDay {
  date: string;
  poolCount: number;
  dispatchedCount: number;
  totalValuePence: number;
  postcodeAreas: number;
}

interface BestFitDate {
  date: string;
  nearbyCount: number;
}

interface ClusterJob {
  id: string;
  customerName: string;
  jobDescription: string;
  contextualHeadline: string | null;
  basePrice: number | null;
  postcode: string | null;
  address: string | null;
  coordinates: { lat: number; lng: number } | null;
  availableDates: string[] | null;
  phone: string | null;
  bestFitDate?: BestFitDate | null;
}

interface ContractorScore {
  id: string;
  name: string;
  score: number;
  existingJobsOnDate: number;
  skills?: string[];
  reasons?: string[];
  postcode?: string | null;
}

interface Cluster {
  postcodeArea: string;
  areaLabel?: string | null;
  radiusMiles?: number | null;
  jobs: ClusterJob[];
  totalValuePence: number;
  totalJobs: number;
  suggestedContractor: ContractorScore | null;
  allContractors: ContractorScore[];
}

interface DispatchedJob {
  id: string;
  customerName: string;
  postcode: string | null;
  address: string | null;
  coordinates: { lat: number; lng: number } | null;
  jobDescription: string;
  contextualHeadline: string | null;
  basePrice: number | null;
  timeSlotType: string | null;
  matchedContractorId: string | null;
  matchedContractorName: string | null;
}

interface AutoGroupResponse {
  date: string;
  clusters: Cluster[];
  dispatched: DispatchedJob[];
  contractors: {
    id: string;
    name: string;
    postcode: string | null;
    skills: string[];
    latitude: string | null;
    longitude: string | null;
  }[];
}

interface PoolJob {
  id: string;
  customerName: string;
  phone: string;
  email?: string;
  postcode?: string;
  address?: string;
  coordinates?: { lat: number; lng: number } | null;
  jobDescription: string;
  basePrice: number | null;
  depositPaidAt: string | null;
  bookedAt: string | null;
  selectedDate: string | null;
  timeSlotType: string | null;
  availableDates: string[] | null;
  dateTimePreferences: { date: string; timeSlot: string }[] | null;
  contextualHeadline: string | null;
  segment: string | null;
  matchedContractorId: string | null;
  assignedContractorId?: string | null;
  createdAt: string;
}

interface Contractor {
  id: string;
  name?: string;
  businessName?: string;
  profileImageUrl?: string | null;
  postcode?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  availabilityStatus?: string;
  hourlyRate?: number;
  user?: {
    firstName: string;
    lastName: string;
    email: string;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPence(pence: number | null): string {
  if (!pence) return "--";
  return `£${(pence / 100).toFixed(0)}`;
}

function formatPenceFull(pence: number | null): string {
  if (!pence) return "--";
  return `£${(pence / 100).toFixed(2)}`;
}

function dateLabel(dateStr: string): string {
  try {
    const d = parseISO(dateStr);
    if (isToday(d)) return "Today";
    if (isTomorrow(d)) return "Tomorrow";
    return format(d, "EEE d MMM");
  } catch {
    return dateStr;
  }
}

function slotLabel(slot: string | null | undefined): string {
  if (!slot) return "";
  switch (slot.toLowerCase()) {
    case "am":
      return "AM (8am-12pm)";
    case "pm":
      return "PM (12pm-5pm)";
    case "full_day":
    case "fullday":
      return "Full Day";
    default:
      return slot;
  }
}

function postcodeArea(postcode: string | null | undefined): string {
  if (!postcode) return "Unknown";
  return postcode.split(" ")[0].toUpperCase();
}

function formatSkill(slug: string): string {
  return slug
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getContractorName(c: Contractor): string {
  if (c.user) return `${c.user.firstName} ${c.user.lastName}`.trim();
  if (c.name) return c.name;
  if (c.businessName) return c.businessName;
  return "Unknown";
}

function getContractorCoords(c: { latitude?: string | null; longitude?: string | null }): { lat: number; lng: number } | null {
  if (c.latitude && c.longitude) {
    const lat = parseFloat(c.latitude);
    const lng = parseFloat(c.longitude);
    if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
  }
  return null;
}

function getMonday(d: Date): Date {
  return startOfWeek(d, { weekStartsOn: 1 });
}

// ─── Map Icons ──────────────────────────────────────────────────────────────

function createJobIcon(color: string, opts?: { highlighted?: boolean; dimmed?: boolean }): L.DivIcon {
  const size = opts?.highlighted ? 18 : 12;
  const opacity = opts?.dimmed ? 0.3 : 1;
  const boxShadow = opts?.highlighted
    ? `0 0 8px 3px ${color}88, 0 1px 4px rgba(0,0,0,0.4)`
    : "0 1px 4px rgba(0,0,0,0.4)";

  return L.divIcon({
    className: "",
    html: `<div style="
      width: ${size}px; height: ${size}px;
      background: ${color};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: ${boxShadow};
      opacity: ${opacity};
      transition: all 0.2s ease;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 2)],
  });
}

function createContractorIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 14px; height: 14px;
      background: #3b82f6;
      border: 2px solid white;
      border-radius: 3px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4);
      transform: rotate(45deg);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

const amberIcon = createJobIcon("#f59e0b");
const greenIcon = createJobIcon("#22c55e");
const contractorIcon = createContractorIcon();

// ─── Map Bounds Updater ─────────────────────────────────────────────────────

function MapBoundsUpdater({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const prevCount = useRef(0);

  useEffect(() => {
    if (positions.length > 0 && positions.length !== prevCount.current) {
      const bounds = L.latLngBounds(positions.map(([lat, lng]) => [lat, lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      prevCount.current = positions.length;
    }
  }, [positions, map]);

  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DailyPlannerPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ─── State ────────────────────────────────────────────────────────────────
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(getMonday(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [dispatchedExpanded, setDispatchedExpanded] = useState(false);
  const [highlightedCluster, setHighlightedCluster] = useState<string | null>(null);

  // Per-cluster state: selected slot and contractor override
  const [clusterSlots, setClusterSlots] = useState<Record<string, string>>({});
  const [clusterContractors, setClusterContractors] = useState<Record<string, string>>({});

  // Dispatch All confirmation dialog state
  const [dispatchAllDialogOpen, setDispatchAllDialogOpen] = useState(false);
  const [dispatchAllInProgress, setDispatchAllInProgress] = useState(false);

  // Dispatch modal state (fallback for individual jobs)
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<PoolJob | null>(null);
  const [confirmedDate, setConfirmedDate] = useState<string>("");
  const [confirmedSlot, setConfirmedSlot] = useState<string>("");
  const [selectedContractorId, setSelectedContractorId] = useState<string>("");

  // Auth
  const adminToken = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  const authHeaders: Record<string, string> = adminToken
    ? { Authorization: `Bearer ${adminToken}` }
    : {};

  // ─── Derived dates ────────────────────────────────────────────────────────
  const weekStartStr = format(selectedWeekStart, "yyyy-MM-dd");
  const weekEnd = addDays(selectedWeekStart, 5); // Mon-Sat = 6 days
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  const weekDays = useMemo(() => {
    return eachDayOfInterval({ start: selectedWeekStart, end: weekEnd });
  }, [selectedWeekStart]);

  // ─── Week Overview Query ──────────────────────────────────────────────────
  const { data: weekOverview, isLoading: weekLoading } = useQuery<{ days: WeekDay[] }>({
    queryKey: ["daily-planner-week", weekStartStr],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/daily-planner/week-overview?from=${weekStartStr}&to=${weekEndStr}`,
        { headers: authHeaders }
      );
      if (!res.ok) throw new Error("Failed to fetch week overview");
      return res.json();
    },
    refetchInterval: 30000,
  });

  // ─── Auto-Group Query ─────────────────────────────────────────────────────
  const { data: autoGroupData, isLoading: autoGroupLoading } = useQuery<AutoGroupResponse>({
    queryKey: ["daily-planner-autogroup", selectedDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/daily-planner/auto-group?date=${selectedDate}`,
        { headers: authHeaders }
      );
      if (!res.ok) throw new Error("Failed to fetch auto-group data");
      return res.json();
    },
    enabled: !!selectedDate,
    refetchInterval: 30000,
  });

  // ─── Contractors query (for dispatch modal fallback) ──────────────────────
  const { data: contractors } = useQuery<Contractor[]>({
    queryKey: ["daily-planner-contractors"],
    queryFn: async () => {
      const res = await fetch("/api/handymen", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to fetch contractors");
      return res.json();
    },
  });

  // ─── Cluster Confirm Mutation ─────────────────────────────────────────────
  const clusterDispatchMutation = useMutation({
    mutationFn: async ({
      postcodeArea,
      jobIds,
      contractorId,
      slot,
    }: {
      postcodeArea: string;
      jobIds: string[];
      contractorId: string;
      slot: string;
    }) => {
      const res = await fetch("/api/admin/daily-planner/confirm-cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          date: selectedDate,
          slot,
          contractorId,
          jobIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to dispatch cluster");
      return { ...data, postcodeArea };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["daily-planner-week", weekStartStr] });
      queryClient.invalidateQueries({ queryKey: ["daily-planner-autogroup", selectedDate] });
      const formattedDate = format(parseISO(selectedDate), "EEEE d MMM");
      toast({
        title: "Cluster Dispatched",
        description: `${data.dispatched} job${data.dispatched !== 1 ? "s" : ""} dispatched to ${data.contractorName} for ${formattedDate}${data.skipped > 0 ? ` (${data.skipped} skipped — already dispatched)` : ""}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Dispatch Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ─── Individual Dispatch Mutation (fallback modal) ────────────────────────
  const dispatchMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob || !confirmedDate || !confirmedSlot || !selectedContractorId) {
        throw new Error("Please fill in all fields");
      }
      const res = await fetch("/api/admin/daily-planner/confirm-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          quoteId: selectedJob.id,
          confirmedDate,
          confirmedSlot,
          contractorId: selectedContractorId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to dispatch job");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["daily-planner-week", weekStartStr] });
      queryClient.invalidateQueries({ queryKey: ["daily-planner-autogroup", selectedDate] });
      queryClient.invalidateQueries({ queryKey: ["daily-planner-pool"] });
      closeDispatchModal();
      toast({
        title: "Job Dispatched!",
        description: data.message || `Customer notified. Contractor: ${data.contractorName || "assigned"}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Dispatch Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ─── Modal Helpers ────────────────────────────────────────────────────────
  const openDispatchModal = (job: PoolJob) => {
    setSelectedJob(job);
    const dates = job.availableDates || [];
    if (dates.length > 0) {
      setConfirmedDate(dates[0]);
    } else if (job.selectedDate) {
      setConfirmedDate(job.selectedDate);
    }
    setConfirmedSlot(job.timeSlotType || "am");
    setSelectedContractorId(job.matchedContractorId || "");
    setDispatchModalOpen(true);
  };

  const closeDispatchModal = () => {
    setDispatchModalOpen(false);
    setSelectedJob(null);
    setConfirmedDate("");
    setConfirmedSlot("");
    setSelectedContractorId("");
  };

  // ─── Week Navigation ─────────────────────────────────────────────────────
  const goToPrevWeek = () => setSelectedWeekStart((d) => addWeeks(d, -1));
  const goToNextWeek = () => setSelectedWeekStart((d) => addWeeks(d, 1));
  const goToThisWeek = () => {
    const monday = getMonday(new Date());
    setSelectedWeekStart(monday);
    setSelectedDate(format(new Date(), "yyyy-MM-dd"));
  };

  // ─── Map Data ─────────────────────────────────────────────────────────────
  const mapPositions = useMemo(() => {
    const positions: [number, number][] = [];
    if (autoGroupData) {
      for (const cluster of autoGroupData.clusters) {
        for (const job of cluster.jobs) {
          if (job.coordinates?.lat && job.coordinates?.lng) {
            positions.push([job.coordinates.lat, job.coordinates.lng]);
          }
        }
      }
      for (const job of autoGroupData.dispatched || []) {
        if (job.coordinates?.lat && job.coordinates?.lng) {
          positions.push([job.coordinates.lat, job.coordinates.lng]);
        }
      }
      for (const c of autoGroupData.contractors || []) {
        const coords = getContractorCoords(c);
        if (coords) positions.push([coords.lat, coords.lng]);
      }
    }
    return positions;
  }, [autoGroupData]);

  // ─── Week overview map ────────────────────────────────────────────────────
  const weekDayMap = useMemo(() => {
    const m = new Map<string, WeekDay>();
    if (weekOverview?.days) {
      for (const d of weekOverview.days) {
        m.set(d.date, d);
      }
    }
    return m;
  }, [weekOverview]);

  // ─── Cluster helpers ──────────────────────────────────────────────────────
  const getClusterSlot = (area: string): string => clusterSlots[area] || "full_day";
  const getClusterContractor = (cluster: Cluster): string =>
    clusterContractors[cluster.postcodeArea] || cluster.suggestedContractor?.id || "";

  const handleConfirmCluster = (cluster: Cluster) => {
    const contractorId = getClusterContractor(cluster);
    const slot = getClusterSlot(cluster.postcodeArea);
    if (!contractorId) {
      toast({
        title: "No contractor selected",
        description: "Please select a contractor for this cluster.",
        variant: "destructive",
      });
      return;
    }
    clusterDispatchMutation.mutate({
      postcodeArea: cluster.postcodeArea,
      jobIds: cluster.jobs.map((j) => j.id),
      contractorId,
      slot,
    });
  };

  // ─── Dispatch All Handler ──────────────────────────────────────────────────
  const handleDispatchAll = async () => {
    if (!autoGroupData?.clusters.length) return;
    setDispatchAllInProgress(true);

    let totalDispatched = 0;
    let totalSkipped = 0;
    let failures: string[] = [];

    for (const cluster of autoGroupData.clusters) {
      const contractorId = getClusterContractor(cluster);
      const slot = getClusterSlot(cluster.postcodeArea);

      if (!contractorId) {
        failures.push(`${cluster.areaLabel || cluster.postcodeArea}: no contractor selected`);
        continue;
      }

      try {
        const res = await fetch("/api/admin/daily-planner/confirm-cluster", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            date: selectedDate,
            slot,
            contractorId,
            jobIds: cluster.jobs.map((j) => j.id),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          failures.push(`${cluster.areaLabel || cluster.postcodeArea}: ${data.error || "failed"}`);
        } else {
          totalDispatched += data.dispatched || 0;
          totalSkipped += data.skipped || 0;
        }
      } catch (err: any) {
        failures.push(`${cluster.areaLabel || cluster.postcodeArea}: ${err.message}`);
      }
    }

    setDispatchAllInProgress(false);
    setDispatchAllDialogOpen(false);

    // Refresh data
    queryClient.invalidateQueries({ queryKey: ["daily-planner-week", weekStartStr] });
    queryClient.invalidateQueries({ queryKey: ["daily-planner-autogroup", selectedDate] });

    if (failures.length > 0) {
      toast({
        title: `Partially dispatched: ${totalDispatched} job${totalDispatched !== 1 ? "s" : ""} sent`,
        description: `${failures.length} cluster${failures.length !== 1 ? "s" : ""} failed: ${failures.join("; ")}${totalSkipped > 0 ? `. ${totalSkipped} skipped (already dispatched).` : ""}`,
        variant: "destructive",
      });
    } else {
      toast({
        title: `${totalDispatched} job${totalDispatched !== 1 ? "s" : ""} dispatched successfully`,
        description: totalSkipped > 0 ? `${totalSkipped} skipped (already dispatched).` : undefined,
      });
    }
  };

  // ─── Dispatch All summary info ─────────────────────────────────────────────
  const dispatchAllJobCount = autoGroupData?.clusters.reduce((sum, c) => sum + c.totalJobs, 0) || 0;
  const dispatchAllClusterCount = autoGroupData?.clusters.length || 0;
  const dispatchAllContractorNames = useMemo(() => {
    if (!autoGroupData?.clusters) return [];
    const names = new Set<string>();
    for (const cluster of autoGroupData.clusters) {
      const contractorId = getClusterContractor(cluster);
      const contractor = cluster.allContractors.find((c) => c.id === contractorId);
      if (contractor) names.add(contractor.name);
    }
    return Array.from(names);
  }, [autoGroupData, clusterContractors]);

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (weekLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Page Header */}
      <div className="flex-shrink-0 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 pt-4 pb-2 md:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Daily Planner
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dispatch pool jobs to contractors
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={goToPrevWeek}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant={isToday(selectedWeekStart) || format(getMonday(new Date()), "yyyy-MM-dd") === weekStartStr ? "default" : "outline"}
            size="sm"
            onClick={goToThisWeek}
          >
            This Week
          </Button>
          <Button variant="outline" size="icon" onClick={goToNextWeek}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Week Overview Strip */}
      <div className="flex-shrink-0 px-4 pb-3 md:px-6">
        <div className="grid grid-cols-6 gap-2">
          {weekDays.map((day) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const dayData = weekDayMap.get(dateStr);
            const isSelected = dateStr === selectedDate;
            const isEmpty = !dayData || (dayData.poolCount === 0 && dayData.dispatchedCount === 0);

            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                className={`rounded-lg border-2 p-2 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : isEmpty
                      ? "border-border/50 bg-muted/30 opacity-60 hover:opacity-80"
                      : "border-border hover:border-muted-foreground/40 hover:bg-muted/50"
                }`}
              >
                <div className="text-xs font-medium text-muted-foreground">
                  {format(day, "EEE")}
                </div>
                <div className={`text-lg font-bold ${isSelected ? "text-primary" : "text-foreground"}`}>
                  {format(day, "d")}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {format(day, "MMM")}
                </div>
                {dayData && (
                  <div className="mt-1 space-y-0.5">
                    {dayData.poolCount > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                        <span className="text-[10px] text-amber-600 font-medium">
                          {dayData.poolCount} pool
                        </span>
                      </div>
                    )}
                    {dayData.dispatchedCount > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-[10px] text-green-600 font-medium">
                          {dayData.dispatchedCount} sent
                        </span>
                      </div>
                    )}
                    {dayData.totalValuePence > 0 && (
                      <div className="text-[10px] text-muted-foreground font-medium">
                        {formatPence(dayData.totalValuePence)}
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Split View: Clusters + Map */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel (45%) — Clusters */}
        <div className="w-[45%] flex-shrink-0 overflow-y-auto border-r border-border px-4 pb-4 md:px-6 space-y-4">
          {/* Selected Day Header */}
          <div className="flex items-center justify-between pt-2 gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                {format(parseISO(selectedDate), "EEEE d MMMM yyyy")}
              </h2>
              {autoGroupData && (
                <Badge variant="outline" className="text-[10px] flex-shrink-0">
                  {autoGroupData.clusters.length} cluster{autoGroupData.clusters.length !== 1 ? "s" : ""},{" "}
                  {autoGroupData.clusters.reduce((sum, c) => sum + c.totalJobs, 0)} job{autoGroupData.clusters.reduce((sum, c) => sum + c.totalJobs, 0) !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            {autoGroupData && autoGroupData.clusters.length > 0 && (
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white flex-shrink-0"
                onClick={() => setDispatchAllDialogOpen(true)}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Dispatch All ({dispatchAllJobCount} job{dispatchAllJobCount !== 1 ? "s" : ""})
              </Button>
            )}
          </div>

          {autoGroupLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading clusters...</span>
            </div>
          ) : autoGroupData && autoGroupData.clusters.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                <CheckCircle2 className="mx-auto h-8 w-8 mb-2 text-green-500" />
                <p className="text-sm">No pool jobs available for this date.</p>
                <p className="text-xs mt-1">All paid jobs have been dispatched or no jobs are scheduled.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {autoGroupData?.clusters.map((cluster) => {
                const currentSlot = getClusterSlot(cluster.postcodeArea);
                const currentContractorId = getClusterContractor(cluster);
                const selectedContractorInfo = cluster.allContractors.find(
                  (c) => c.id === currentContractorId
                );
                const isDispatching =
                  clusterDispatchMutation.isPending &&
                  clusterDispatchMutation.variables?.postcodeArea === cluster.postcodeArea;

                return (
                  <Card
                    key={cluster.postcodeArea}
                    className="border-l-4 border-l-amber-500"
                    onMouseEnter={() => setHighlightedCluster(cluster.postcodeArea)}
                    onMouseLeave={() => setHighlightedCluster(null)}
                  >
                    <CardHeader className="pb-2 px-4 pt-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-amber-600" />
                            <CardTitle className="text-base">
                              {cluster.areaLabel ? `${cluster.areaLabel} area` : cluster.postcodeArea}
                            </CardTitle>
                            <Badge variant="secondary" className="text-[10px]">
                              {cluster.totalJobs} job{cluster.totalJobs !== 1 ? "s" : ""}
                            </Badge>
                            <span className="text-sm font-semibold text-green-600">
                              {formatPence(cluster.totalValuePence)}
                            </span>
                          </div>
                          {cluster.radiusMiles != null && (
                            <span className="text-[10px] text-muted-foreground ml-6">
                              {cluster.radiusMiles.toFixed(1)} mile radius
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Suggested contractor */}
                      {cluster.suggestedContractor && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <Users className="h-3.5 w-3.5 text-blue-500" />
                          <span className="text-xs text-muted-foreground">
                            Suggested:{" "}
                            <span className="font-medium text-foreground">
                              {cluster.suggestedContractor.name}
                            </span>
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700"
                          >
                            Score: {cluster.suggestedContractor.score}
                          </Badge>
                        </div>
                      )}
                      {cluster.suggestedContractor?.reasons && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {cluster.suggestedContractor.reasons.map((r, i) => (
                            <span key={i} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </CardHeader>

                    <CardContent className="px-4 pb-4 space-y-3">
                      {/* Job list */}
                      <div className="space-y-2">
                        {cluster.jobs.map((job) => {
                          const hasBetterFit =
                            job.bestFitDate &&
                            job.bestFitDate.date !== selectedDate;
                          return (
                            <div
                              key={job.id}
                              className="rounded-md border bg-muted/30 p-2.5"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium truncate">
                                      {job.customerName}
                                    </span>
                                    {job.basePrice && (
                                      <span className="text-xs font-semibold text-green-600 flex-shrink-0">
                                        {formatPence(job.basePrice)}
                                      </span>
                                    )}
                                    {hasBetterFit && (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px] py-0 px-1.5 border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-700"
                                      >
                                        Better fit: {(() => {
                                          try {
                                            return format(parseISO(job.bestFitDate!.date), "EEE");
                                          } catch {
                                            return job.bestFitDate!.date;
                                          }
                                        })()} ({job.bestFitDate!.nearbyCount} nearby job{job.bestFitDate!.nearbyCount !== 1 ? "s" : ""})
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                    {job.contextualHeadline || job.jobDescription}
                                  </p>
                                  {job.postcode && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                      <MapPin className="h-2.5 w-2.5" />
                                      {job.address || job.postcode}
                                    </span>
                                  )}
                                  {job.availableDates && job.availableDates.length > 0 && (
                                    <div className="text-[10px] text-muted-foreground/70 mt-1">
                                      Available:{" "}
                                      {job.availableDates.map((d, i) => (
                                        <span key={d}>
                                          {i > 0 && " \u00b7 "}
                                          {(() => {
                                            try {
                                              return format(parseISO(d), "EEE d");
                                            } catch {
                                              return d;
                                            }
                                          })()}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Time Slot Picker */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Time Slot</Label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {["am", "pm", "full_day"].map((slot) => (
                            <Button
                              key={slot}
                              type="button"
                              variant={currentSlot === slot ? "default" : "outline"}
                              size="sm"
                              className="text-xs h-7"
                              onClick={() =>
                                setClusterSlots((prev) => ({
                                  ...prev,
                                  [cluster.postcodeArea]: slot,
                                }))
                              }
                            >
                              {slot === "am" ? "AM" : slot === "pm" ? "PM" : "Full Day"}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {/* Contractor Override Dropdown */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Contractor</Label>
                        <Select
                          value={currentContractorId}
                          onValueChange={(val) =>
                            setClusterContractors((prev) => ({
                              ...prev,
                              [cluster.postcodeArea]: val,
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select contractor" />
                          </SelectTrigger>
                          <SelectContent>
                            {cluster.allContractors.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-2">
                                  {c.name}
                                  <span className="text-muted-foreground">
                                    (Score: {c.score}, {c.existingJobsOnDate} job{c.existingJobsOnDate !== 1 ? "s" : ""})
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {selectedContractorInfo && selectedContractorInfo.skills && selectedContractorInfo.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {selectedContractorInfo.skills.slice(0, 5).map((s, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px] font-normal py-0">
                                {formatSkill(s)}
                              </Badge>
                            ))}
                            {selectedContractorInfo.skills.length > 5 && (
                              <Badge variant="secondary" className="text-[10px] font-normal py-0">
                                +{selectedContractorInfo.skills.length - 5} more
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Confirm Button */}
                      <Button
                        className="w-full bg-green-600 hover:bg-green-700 text-white"
                        size="sm"
                        disabled={!currentContractorId || isDispatching}
                        onClick={() => handleConfirmCluster(cluster)}
                      >
                        {isDispatching ? (
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                        )}
                        Confirm Cluster ({cluster.totalJobs} job{cluster.totalJobs !== 1 ? "s" : ""})
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Already Dispatched Section */}
          {autoGroupData && autoGroupData.dispatched && autoGroupData.dispatched.length > 0 && (
            <div className="pt-2">
              <button
                onClick={() => setDispatchedExpanded(!dispatchedExpanded)}
                className="flex items-center gap-2 w-full text-left"
              >
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm font-semibold">
                  Already Dispatched for {format(parseISO(selectedDate), "d MMM")}
                </span>
                <Badge
                  variant="outline"
                  className="bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700 text-[10px]"
                >
                  {autoGroupData.dispatched.length}
                </Badge>
                {dispatchedExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />
                )}
              </button>

              {dispatchedExpanded && (
                <div className="grid gap-2 mt-2">
                  {autoGroupData.dispatched.map((job) => (
                    <Card key={job.id} className="border-l-4 border-l-green-500">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{job.customerName}</span>
                              {job.basePrice && (
                                <span className="text-xs font-semibold text-green-600">
                                  {formatPence(job.basePrice)}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {job.contextualHeadline || job.jobDescription}
                            </p>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-muted-foreground">
                              {job.postcode && (
                                <span className="flex items-center gap-0.5">
                                  <MapPin className="h-2.5 w-2.5" /> {job.postcode}
                                </span>
                              )}
                              {job.timeSlotType && (
                                <span className="flex items-center gap-0.5">
                                  <Clock className="h-2.5 w-2.5" /> {slotLabel(job.timeSlotType)}
                                </span>
                              )}
                              {job.matchedContractorName && (
                                <span className="flex items-center gap-0.5">
                                  <Users className="h-2.5 w-2.5" /> {job.matchedContractorName}
                                </span>
                              )}
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className="text-[10px] bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700 flex-shrink-0"
                          >
                            Dispatched
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel (55%) — Map */}
        <div className="flex-1 relative">
          <MapContainer
            center={[52.95, -1.15]}
            zoom={12}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            <MapBoundsUpdater positions={mapPositions} />

            {/* Amber pins: Pool jobs from clusters */}
            {autoGroupData?.clusters.flatMap((cluster) =>
              cluster.jobs.map((job) => {
                if (!job.coordinates?.lat || !job.coordinates?.lng) return null;
                const isHighlighted = highlightedCluster === cluster.postcodeArea;
                const isDimmed = highlightedCluster !== null && !isHighlighted;
                const icon = isHighlighted
                  ? createJobIcon("#ef4444", { highlighted: true })
                  : isDimmed
                    ? createJobIcon("#f59e0b", { dimmed: true })
                    : amberIcon;
                return (
                  <Marker
                    key={`pool-${job.id}`}
                    position={[job.coordinates.lat, job.coordinates.lng]}
                    icon={icon}
                  >
                    <Popup>
                      <div className="min-w-[180px] p-1">
                        <div className="font-semibold text-sm text-slate-900">
                          {job.customerName}
                        </div>
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                          {job.contextualHeadline || job.jobDescription}
                        </p>
                        {job.postcode && (
                          <div className="text-xs text-slate-500 mt-1">{job.postcode}</div>
                        )}
                        {job.basePrice && (
                          <div className="text-xs font-semibold text-green-600 mt-1">
                            {formatPence(job.basePrice)}
                          </div>
                        )}
                        <div className="text-[10px] font-medium text-amber-600 mt-1.5">
                          {cluster.postcodeArea} cluster
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })
            )}

            {/* Green pins: Dispatched jobs */}
            {autoGroupData?.dispatched?.map((job) => {
              if (!job.coordinates?.lat || !job.coordinates?.lng) return null;
              const dispatchedIcon = highlightedCluster
                ? createJobIcon("#22c55e", { dimmed: true })
                : greenIcon;
              return (
                <Marker
                  key={`disp-${job.id}`}
                  position={[job.coordinates.lat, job.coordinates.lng]}
                  icon={dispatchedIcon}
                >
                  <Popup>
                    <div className="min-w-[180px] p-1">
                      <div className="font-semibold text-sm text-slate-900">
                        {job.customerName}
                      </div>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                        {job.contextualHeadline || job.jobDescription}
                      </p>
                      {job.postcode && (
                        <div className="text-xs text-slate-500 mt-1">{job.postcode}</div>
                      )}
                      {job.basePrice && (
                        <div className="text-xs font-semibold text-green-600 mt-1">
                          {formatPence(job.basePrice)}
                        </div>
                      )}
                      {job.matchedContractorName && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {job.matchedContractorName}
                        </div>
                      )}
                      <div className="text-[10px] font-medium text-green-600 mt-1.5">
                        Dispatched
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {/* Blue pins: Contractor home locations */}
            {autoGroupData?.contractors?.map((c) => {
              const coords = getContractorCoords(c);
              if (!coords) return null;
              return (
                <Marker
                  key={`ctr-${c.id}`}
                  position={[coords.lat, coords.lng]}
                  icon={contractorIcon}
                >
                  <Popup>
                    <div className="min-w-[140px] p-1">
                      <div className="font-semibold text-sm text-slate-900">{c.name}</div>
                      {c.postcode && (
                        <div className="text-xs text-slate-500 mt-0.5">{c.postcode}</div>
                      )}
                      {c.skills.length > 0 && (
                        <div className="text-[10px] text-slate-500 mt-1">
                          {c.skills.slice(0, 3).map(formatSkill).join(", ")}
                          {c.skills.length > 3 ? ` +${c.skills.length - 3}` : ""}
                        </div>
                      )}
                      <div className="text-[10px] font-medium text-blue-600 mt-1">
                        Contractor
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MapContainer>

          {/* Map Legend */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm rounded-lg border border-border px-3 py-2 shadow-md text-xs space-y-1.5">
            <div className="font-medium text-foreground mb-1">Legend</div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-amber-500 border border-white shadow-sm" />
              <span className="text-muted-foreground">Awaiting dispatch</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full bg-green-500 border border-white shadow-sm" />
              <span className="text-muted-foreground">Dispatched</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-sm bg-blue-500 border border-white shadow-sm"
                style={{ transform: "rotate(45deg)" }}
              />
              <span className="text-muted-foreground">Contractor</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Dispatch Modal (fallback for individual job dispatch) ──────────── */}
      <Dialog
        open={dispatchModalOpen}
        onOpenChange={(open) => {
          if (!open) closeDispatchModal();
        }}
      >
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Confirm & Dispatch
            </DialogTitle>
            <DialogDescription>
              Pick the date, time slot, and contractor for this job.
            </DialogDescription>
          </DialogHeader>

          {selectedJob && (
            <div className="space-y-5 py-2">
              {/* Job Summary */}
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{selectedJob.customerName}</span>
                  <span className="text-sm font-semibold text-green-600">
                    {formatPence(selectedJob.basePrice)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {selectedJob.contextualHeadline || selectedJob.jobDescription}
                </p>
                {selectedJob.postcode && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {selectedJob.address || selectedJob.postcode}
                  </div>
                )}
              </div>

              {/* Date Selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Confirmed Date</Label>
                {selectedJob.availableDates && selectedJob.availableDates.length > 0 ? (
                  <RadioGroup
                    value={confirmedDate}
                    onValueChange={setConfirmedDate}
                    className="grid gap-2"
                  >
                    {selectedJob.availableDates.map((dateStr) => (
                      <label
                        key={dateStr}
                        className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                          confirmedDate === dateStr
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/50"
                        }`}
                      >
                        <RadioGroupItem value={dateStr} />
                        <div className="flex-1">
                          <span className="text-sm font-medium">{dateLabel(dateStr)}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {(() => {
                              try {
                                return format(parseISO(dateStr), "EEEE d MMMM");
                              } catch {
                                return dateStr;
                              }
                            })()}
                          </span>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                ) : (
                  <div className="text-sm text-muted-foreground italic p-2 rounded border border-dashed">
                    No preferred dates set. The customer selected:{" "}
                    <span className="font-medium">
                      {selectedJob.selectedDate
                        ? dateLabel(selectedJob.selectedDate)
                        : "none"}
                    </span>
                  </div>
                )}
              </div>

              {/* Time Slot */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Time Slot</Label>
                <div className="grid grid-cols-3 gap-2">
                  {["am", "pm", "full_day"].map((slot) => (
                    <Button
                      key={slot}
                      type="button"
                      variant={confirmedSlot === slot ? "default" : "outline"}
                      size="sm"
                      className="w-full"
                      onClick={() => setConfirmedSlot(slot)}
                    >
                      {slot === "am" ? "AM" : slot === "pm" ? "PM" : "Full Day"}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Contractor Selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Assign Contractor</Label>
                <Select
                  value={selectedContractorId}
                  onValueChange={setSelectedContractorId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select contractor" />
                  </SelectTrigger>
                  <SelectContent>
                    {contractors?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {getContractorName(c)}
                        {c.postcode ? ` (${postcodeArea(c.postcode)})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeDispatchModal}>
              Cancel
            </Button>
            <Button
              onClick={() => dispatchMutation.mutate()}
              disabled={
                dispatchMutation.isPending ||
                !confirmedDate ||
                !confirmedSlot ||
                !selectedContractorId
              }
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {dispatchMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Truck className="mr-2 h-4 w-4" />
              )}
              Dispatch Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dispatch All Confirmation Dialog ─────────────────────────────── */}
      <Dialog
        open={dispatchAllDialogOpen}
        onOpenChange={(open) => {
          if (!open && !dispatchAllInProgress) setDispatchAllDialogOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Dispatch All Clusters
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. Jobs will be dispatched to contractors immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="py-3 space-y-3">
            <p className="text-sm">
              Dispatch <span className="font-semibold">{dispatchAllJobCount} job{dispatchAllJobCount !== 1 ? "s" : ""}</span> across{" "}
              <span className="font-semibold">{dispatchAllClusterCount} cluster{dispatchAllClusterCount !== 1 ? "s" : ""}</span>?
            </p>
            {dispatchAllContractorNames.length > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Contractors: </span>
                <span className="font-medium">{dispatchAllContractorNames.join(", ")}</span>
              </div>
            )}
            {dispatchAllContractorNames.length < dispatchAllClusterCount && (
              <p className="text-xs text-amber-600">
                Warning: {dispatchAllClusterCount - dispatchAllContractorNames.length} cluster{dispatchAllClusterCount - dispatchAllContractorNames.length !== 1 ? "s have" : " has"} no contractor selected and will be skipped.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDispatchAllDialogOpen(false)}
              disabled={dispatchAllInProgress}
            >
              Cancel
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleDispatchAll}
              disabled={dispatchAllInProgress}
            >
              {dispatchAllInProgress ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {dispatchAllInProgress ? "Dispatching..." : `Dispatch ${dispatchAllJobCount} Jobs`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
