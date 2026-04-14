import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Users,
  Search,
  Phone,
  Star,
  Wrench,
  Calendar,
  ClipboardList,
  Save,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  UserCheck,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JobApplication {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  postcode: string | null;
  trades: string[] | null;
  yearsExperience: string | null;
  hasOwnTools: boolean | null;
  hasDrivingLicence: boolean | null;
  hasCSCS: boolean | null;
  currentSituation: string | null;
  coverNote: string | null;
  source: string | null;
  status: string;
  statusNotes: string | null;
  rating: number | null;
  assessmentSilicone: number | null;
  assessmentCarpentry: number | null;
  assessmentPainting: number | null;
  assessmentMounting: number | null;
  assessmentNotes: string | null;
  appliedAt: string;
  screenedAt: string | null;
  assessedAt: string | null;
  hiredAt: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Status Config
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "phone_screened", label: "Phone Screened" },
  { value: "assessment_scheduled", label: "Assessment Scheduled" },
  { value: "assessed", label: "Assessed" },
  { value: "offer_made", label: "Offer Made" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
] as const;

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  phone_screened: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  assessment_scheduled: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  assessed: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  offer_made: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  hired: "bg-[#7DB00E]/20 text-[#7DB00E] border-[#7DB00E]/30",
  rejected: "bg-red-500/20 text-red-400 border-red-500/30",
  withdrawn: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

function statusLabel(status: string): string {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
}

const FILTER_TABS = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "phone_screened", label: "Phone Screened" },
  { value: "assessment_scheduled", label: "Assessment" },
  { value: "assessed", label: "Assessed" },
  { value: "offer_made", label: "Offer Made" },
  { value: "hired", label: "Hired" },
  { value: "rejected", label: "Rejected" },
];

// ---------------------------------------------------------------------------
// Star Rating Component
// ---------------------------------------------------------------------------

function StarRating({
  value,
  onChange,
  size = "md",
}: {
  value: number | null;
  onChange: (v: number) => void;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="focus:outline-none"
        >
          <Star
            className={`${sizeClass} transition-colors ${
              (value ?? 0) >= star
                ? "fill-[#7DB00E] text-[#7DB00E]"
                : "text-gray-600 hover:text-gray-400"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDatetime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CareersAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedApp, setSelectedApp] = useState<JobApplication | null>(null);

  // Form state for detail panel
  const [editStatus, setEditStatus] = useState("");
  const [editStatusNotes, setEditStatusNotes] = useState("");
  const [editRating, setEditRating] = useState<number | null>(null);
  const [editSilicone, setEditSilicone] = useState<number | null>(null);
  const [editCarpentry, setEditCarpentry] = useState<number | null>(null);
  const [editPainting, setEditPainting] = useState<number | null>(null);
  const [editMounting, setEditMounting] = useState<number | null>(null);
  const [editAssessmentNotes, setEditAssessmentNotes] = useState("");

  // Fetch applications
  const { data: applications = [], isLoading } = useQuery<JobApplication[]>({
    queryKey: ["admin-careers-applications", statusFilter],
    queryFn: async () => {
      const token = localStorage.getItem("adminToken");
      const params = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const res = await fetch(`/api/admin/careers/applications${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch applications");
      return res.json();
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      if (!selectedApp) return;
      const token = localStorage.getItem("adminToken");
      const res = await fetch(
        `/api/admin/careers/applications/${selectedApp.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) throw new Error("Failed to update application");
      return res.json();
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["admin-careers-applications"] });
      if (updated) setSelectedApp(updated);
      toast({ title: "Application updated", description: "Changes saved successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save changes.", variant: "destructive" });
    },
  });

  // Populate form when selecting an application
  useEffect(() => {
    if (selectedApp) {
      setEditStatus(selectedApp.status);
      setEditStatusNotes(selectedApp.statusNotes ?? "");
      setEditRating(selectedApp.rating);
      setEditSilicone(selectedApp.assessmentSilicone);
      setEditCarpentry(selectedApp.assessmentCarpentry);
      setEditPainting(selectedApp.assessmentPainting);
      setEditMounting(selectedApp.assessmentMounting);
      setEditAssessmentNotes(selectedApp.assessmentNotes ?? "");
    }
  }, [selectedApp]);

  function handleSave() {
    updateMutation.mutate({
      status: editStatus,
      statusNotes: editStatusNotes || undefined,
      rating: editRating ?? undefined,
      assessmentSilicone: editSilicone ?? undefined,
      assessmentCarpentry: editCarpentry ?? undefined,
      assessmentPainting: editPainting ?? undefined,
      assessmentMounting: editMounting ?? undefined,
      assessmentNotes: editAssessmentNotes || undefined,
    });
  }

  // Filter by search term
  const filtered = applications.filter((app) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      app.firstName.toLowerCase().includes(q) ||
      app.lastName.toLowerCase().includes(q) ||
      app.phone.includes(q) ||
      (app.email ?? "").toLowerCase().includes(q) ||
      (app.trades ?? []).some((t) => t.toLowerCase().includes(q))
    );
  });

  // Counts per status
  const counts: Record<string, number> = {};
  applications.forEach((a) => {
    counts[a.status] = (counts[a.status] ?? 0) + 1;
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#7DB00E]/20">
            <Users className="h-6 w-6 text-[#7DB00E]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Careers Pipeline</h1>
            <p className="text-sm text-gray-400">
              {applications.length} application{applications.length !== 1 ? "s" : ""} total
            </p>
          </div>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <Input
            placeholder="Search name, phone, trade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-gray-800 border-gray-700"
          />
        </div>
      </div>

      {/* Status Filter Tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList className="bg-gray-800/50 border border-gray-700 flex-wrap h-auto gap-1 p-1">
          {FILTER_TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="data-[state=active]:bg-[#7DB00E]/20 data-[state=active]:text-[#7DB00E] text-xs sm:text-sm"
            >
              {tab.label}
              {tab.value === "all" && statusFilter === "all" && (
                <span className="ml-1.5 text-xs text-gray-500">
                  ({applications.length})
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Applications Table */}
      <Card className="bg-gray-900 border-gray-800">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-gray-500">
              <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No applications found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-400">Name</TableHead>
                    <TableHead className="text-gray-400 hidden md:table-cell">Phone</TableHead>
                    <TableHead className="text-gray-400 hidden lg:table-cell">Trades</TableHead>
                    <TableHead className="text-gray-400 hidden md:table-cell">Experience</TableHead>
                    <TableHead className="text-gray-400">Status</TableHead>
                    <TableHead className="text-gray-400 hidden sm:table-cell">Applied</TableHead>
                    <TableHead className="text-gray-400 hidden lg:table-cell">Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((app) => (
                    <TableRow
                      key={app.id}
                      className="border-gray-800 cursor-pointer hover:bg-gray-800/60 transition-colors"
                      onClick={() => setSelectedApp(app)}
                    >
                      <TableCell className="font-medium text-white">
                        <div>
                          {app.firstName} {app.lastName}
                        </div>
                        <div className="text-xs text-gray-500 md:hidden">{app.phone}</div>
                      </TableCell>
                      <TableCell className="text-gray-300 hidden md:table-cell">
                        {app.phone}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {(app.trades ?? []).slice(0, 3).map((t) => (
                            <Badge
                              key={t}
                              variant="outline"
                              className="text-xs border-gray-600 text-gray-300 capitalize"
                            >
                              {t}
                            </Badge>
                          ))}
                          {(app.trades ?? []).length > 3 && (
                            <span className="text-xs text-gray-500">
                              +{(app.trades!.length - 3)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-300 hidden md:table-cell">
                        {app.yearsExperience ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs border ${STATUS_COLORS[app.status] ?? STATUS_COLORS.new}`}
                        >
                          {statusLabel(app.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-gray-400 text-sm hidden sm:table-cell">
                        {formatDate(app.appliedAt)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {app.rating ? (
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star
                                key={s}
                                className={`h-3.5 w-3.5 ${
                                  s <= app.rating!
                                    ? "fill-[#7DB00E] text-[#7DB00E]"
                                    : "text-gray-700"
                                }`}
                              />
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-600 text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedApp} onOpenChange={(open) => !open && setSelectedApp(null)}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedApp && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl flex items-center gap-3">
                  <div className="p-1.5 rounded-md bg-[#7DB00E]/20">
                    <UserCheck className="h-5 w-5 text-[#7DB00E]" />
                  </div>
                  {selectedApp.firstName} {selectedApp.lastName}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6 mt-2">
                {/* Contact & Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={selectedApp.phone} />
                  <InfoRow icon={<FileText className="h-4 w-4" />} label="Email" value={selectedApp.email ?? "—"} />
                  <InfoRow icon={<Calendar className="h-4 w-4" />} label="Applied" value={formatDatetime(selectedApp.appliedAt)} />
                  <InfoRow icon={<Wrench className="h-4 w-4" />} label="Experience" value={selectedApp.yearsExperience ?? "—"} />
                  {selectedApp.postcode && (
                    <InfoRow icon={<Clock className="h-4 w-4" />} label="Postcode" value={selectedApp.postcode} />
                  )}
                  {selectedApp.source && (
                    <InfoRow icon={<Search className="h-4 w-4" />} label="Source" value={selectedApp.source} />
                  )}
                  {selectedApp.currentSituation && (
                    <InfoRow icon={<Users className="h-4 w-4" />} label="Situation" value={selectedApp.currentSituation} />
                  )}
                </div>

                {/* Trades */}
                {selectedApp.trades && selectedApp.trades.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Trades</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedApp.trades.map((t) => (
                        <Badge
                          key={t}
                          variant="outline"
                          className="border-[#7DB00E]/30 text-[#7DB00E] capitalize"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Checklist */}
                <div className="flex flex-wrap gap-3 text-sm">
                  <CheckItem label="Own Tools" checked={selectedApp.hasOwnTools} />
                  <CheckItem label="Driving Licence" checked={selectedApp.hasDrivingLicence} />
                  <CheckItem label="CSCS Card" checked={selectedApp.hasCSCS} />
                </div>

                {/* Cover Note */}
                {selectedApp.coverNote && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Cover Note</p>
                    <p className="text-sm text-gray-300 bg-gray-800 rounded-md p-3">
                      {selectedApp.coverNote}
                    </p>
                  </div>
                )}

                {/* Milestones */}
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
                  {selectedApp.screenedAt && <span>Screened: {formatDatetime(selectedApp.screenedAt)}</span>}
                  {selectedApp.assessedAt && <span>Assessed: {formatDatetime(selectedApp.assessedAt)}</span>}
                  {selectedApp.hiredAt && <span>Hired: {formatDatetime(selectedApp.hiredAt)}</span>}
                </div>

                <hr className="border-gray-800" />

                {/* === Editable Section === */}

                {/* Status */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1.5">
                      Status
                    </label>
                    <Select value={editStatus} onValueChange={setEditStatus}>
                      <SelectTrigger className="bg-gray-800 border-gray-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-gray-800 border-gray-700">
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1.5">
                      Overall Rating
                    </label>
                    <StarRating value={editRating} onChange={setEditRating} />
                  </div>
                </div>

                {/* Status Notes */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1.5">
                    Status Notes
                  </label>
                  <Textarea
                    value={editStatusNotes}
                    onChange={(e) => setEditStatusNotes(e.target.value)}
                    placeholder="Internal notes about this applicant..."
                    className="bg-gray-800 border-gray-700 min-h-[80px]"
                  />
                </div>

                {/* Assessment Scores */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                    Assessment Scores
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <ScoreField label="Silicone" value={editSilicone} onChange={setEditSilicone} />
                    <ScoreField label="Carpentry" value={editCarpentry} onChange={setEditCarpentry} />
                    <ScoreField label="Painting" value={editPainting} onChange={setEditPainting} />
                    <ScoreField label="Mounting" value={editMounting} onChange={setEditMounting} />
                  </div>
                </div>

                {/* Assessment Notes */}
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1.5">
                    Assessment Notes
                  </label>
                  <Textarea
                    value={editAssessmentNotes}
                    onChange={(e) => setEditAssessmentNotes(e.target.value)}
                    placeholder="Notes from the practical assessment..."
                    className="bg-gray-800 border-gray-700 min-h-[80px]"
                  />
                </div>

                {/* Save Button */}
                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                    className="bg-[#7DB00E] hover:bg-[#6a9a0c] text-white gap-2"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save Changes
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-500">{icon}</span>
      <span className="text-gray-500">{label}:</span>
      <span className="text-gray-200">{value}</span>
    </div>
  );
}

function CheckItem({ label, checked }: { label: string; checked: boolean | null }) {
  return (
    <div className="flex items-center gap-1.5">
      {checked ? (
        <CheckCircle className="h-4 w-4 text-[#7DB00E]" />
      ) : checked === false ? (
        <XCircle className="h-4 w-4 text-red-400" />
      ) : (
        <XCircle className="h-4 w-4 text-gray-600" />
      )}
      <span className={`text-sm ${checked ? "text-gray-200" : "text-gray-500"}`}>{label}</span>
    </div>
  );
}

function ScoreField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <StarRating value={value} onChange={onChange} size="sm" />
    </div>
  );
}
