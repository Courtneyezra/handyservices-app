import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Extra {
  label: string;
  priceInPence: number;
  description?: string;
}

interface EditQuoteDialogProps {
  quote: any;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function EditQuoteDialog({ quote, open, onClose, onSaved }: EditQuoteDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Form state
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [segment, setSegment] = useState('');
  const [additionalNotes, setAdditionalNotes] = useState('');

  // Pricing
  const [essentialPrice, setEssentialPrice] = useState('');
  const [enhancedPrice, setEnhancedPrice] = useState('');
  const [elitePrice, setElitePrice] = useState('');
  const [basePrice, setBasePrice] = useState('');

  // Extras (for simple mode)
  const [extras, setExtras] = useState<Extra[]>([]);

  // Edit reason
  const [editReason, setEditReason] = useState('');

  // Initialize form when quote changes
  useEffect(() => {
    if (quote) {
      setCustomerName(quote.customerName || '');
      setPhone(quote.phone || '');
      setEmail(quote.email || '');
      setAddress(quote.address || '');
      setPostcode(quote.postcode || '');
      setJobDescription(quote.jobDescription || '');
      setSegment(quote.segment || 'DIY_DEFERRER');
      setAdditionalNotes(quote.additionalNotes || '');

      // Pricing - convert pence to pounds for display
      setEssentialPrice(quote.essentialPrice ? (quote.essentialPrice / 100).toFixed(2) : '');
      setEnhancedPrice(quote.enhancedPrice ? (quote.enhancedPrice / 100).toFixed(2) : '');
      setElitePrice(quote.elitePrice ? (quote.elitePrice / 100).toFixed(2) : '');
      setBasePrice(quote.basePrice ? (quote.basePrice / 100).toFixed(2) : '');

      // Extras
      setExtras(quote.optionalExtras || []);

      setEditReason('');
      setWarnings([]);
    }
  }, [quote]);

  const handleAddExtra = () => {
    setExtras([...extras, { label: '', priceInPence: 0, description: '' }]);
  };

  const handleRemoveExtra = (index: number) => {
    setExtras(extras.filter((_, i) => i !== index));
  };

  const handleExtraChange = (index: number, field: keyof Extra, value: string | number) => {
    const newExtras = [...extras];
    if (field === 'priceInPence') {
      // Convert pounds to pence
      newExtras[index][field] = Math.round(parseFloat(value as string) * 100) || 0;
    } else {
      (newExtras[index] as any)[field] = value;
    }
    setExtras(newExtras);
  };

  const handleSave = async () => {
    setLoading(true);
    setWarnings([]);

    try {
      // Build update payload - only include changed fields
      const updates: Record<string, any> = {};

      if (customerName !== quote.customerName) updates.customerName = customerName;
      if (phone !== quote.phone) updates.phone = phone;
      if (email !== (quote.email || '')) updates.email = email || null;
      if (address !== (quote.address || '')) updates.address = address;
      if (postcode !== (quote.postcode || '')) updates.postcode = postcode;
      if (jobDescription !== quote.jobDescription) updates.jobDescription = jobDescription;
      if (segment !== quote.segment) updates.segment = segment;
      if (additionalNotes !== (quote.additionalNotes || '')) updates.additionalNotes = additionalNotes || null;

      // Pricing - convert pounds to pence
      const essentialPence = essentialPrice ? Math.round(parseFloat(essentialPrice) * 100) : null;
      const enhancedPence = enhancedPrice ? Math.round(parseFloat(enhancedPrice) * 100) : null;
      const elitePence = elitePrice ? Math.round(parseFloat(elitePrice) * 100) : null;
      const basePence = basePrice ? Math.round(parseFloat(basePrice) * 100) : null;

      if (essentialPence !== quote.essentialPrice) updates.essentialPrice = essentialPence;
      if (enhancedPence !== quote.enhancedPrice) updates.enhancedPrice = enhancedPence;
      if (elitePence !== quote.elitePrice) updates.elitePrice = elitePence;
      if (basePence !== quote.basePrice) updates.basePrice = basePence;

      // Extras
      if (JSON.stringify(extras) !== JSON.stringify(quote.optionalExtras || [])) {
        updates.optionalExtras = extras;
      }

      if (editReason) updates.editReason = editReason;

      // Check if anything changed
      if (Object.keys(updates).length === 0 || (Object.keys(updates).length === 1 && updates.editReason)) {
        toast({
          title: "No changes",
          description: "No fields were modified.",
        });
        setLoading(false);
        return;
      }

      const response = await fetch(`/api/admin/personalized-quotes/${quote.id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.blockers) {
          toast({
            title: "Cannot edit quote",
            description: data.blockers.join(' '),
            variant: "destructive",
          });
        } else {
          throw new Error(data.error || 'Failed to save');
        }
        return;
      }

      if (data.warnings && data.warnings.length > 0) {
        setWarnings(data.warnings);
      }

      toast({
        title: "Quote updated",
        description: `${Object.keys(updates).length - (updates.editReason ? 1 : 0)} field(s) updated.`,
      });

      onSaved();

      // Close after short delay if there are warnings to show
      if (!data.warnings || data.warnings.length === 0) {
        onClose();
      }

    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update quote",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const isHHHMode = quote?.quoteMode === 'hhh';
  const isSimpleMode = quote?.quoteMode === 'simple' || quote?.quoteMode === 'pick_and_mix';
  const isPaid = !!quote?.depositPaidAt;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Quote: {quote?.shortSlug}</DialogTitle>
        </DialogHeader>

        {isPaid && (
          <Alert variant="destructive" className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This quote has been paid. Price changes may require additional payment or refund handling.
            </AlertDescription>
          </Alert>
        )}

        {warnings.length > 0 && (
          <Alert className="mb-4 bg-yellow-50 border-yellow-200">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-800">
              {warnings.map((w, i) => <div key={i}>{w}</div>)}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          {/* Customer Details */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-gray-500 uppercase tracking-wide">Customer Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="customerName">Name</Label>
                <Input
                  id="customerName"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="postcode">Postcode</Label>
                <Input
                  id="postcode"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Job Details */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-gray-500 uppercase tracking-wide">Job Details</h3>
            <div>
              <Label htmlFor="jobDescription">Job Description</Label>
              <Textarea
                id="jobDescription"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="segment">Segment</Label>
                <Select value={segment} onValueChange={setSegment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMERGENCY">Emergency</SelectItem>
                    <SelectItem value="BUSY_PRO">Busy Pro</SelectItem>
                    <SelectItem value="PROP_MGR">Property Manager</SelectItem>
                    <SelectItem value="LANDLORD">Landlord</SelectItem>
                    <SelectItem value="SMALL_BIZ">Small Business</SelectItem>
                    <SelectItem value="TRUST_SEEKER">Trust Seeker</SelectItem>
                    <SelectItem value="RENTER">Renter</SelectItem>
                    <SelectItem value="DIY_DEFERRER">DIY Deferrer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="additionalNotes">Additional Notes</Label>
              <Textarea
                id="additionalNotes"
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                rows={2}
                placeholder="Internal notes about this quote..."
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="space-y-4">
            <h3 className="font-medium text-sm text-gray-500 uppercase tracking-wide">Pricing</h3>

            {isHHHMode && (
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="essentialPrice">Essential (£)</Label>
                  <Input
                    id="essentialPrice"
                    type="number"
                    step="0.01"
                    value={essentialPrice}
                    onChange={(e) => setEssentialPrice(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="enhancedPrice">Enhanced (£)</Label>
                  <Input
                    id="enhancedPrice"
                    type="number"
                    step="0.01"
                    value={enhancedPrice}
                    onChange={(e) => setEnhancedPrice(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="elitePrice">Elite (£)</Label>
                  <Input
                    id="elitePrice"
                    type="number"
                    step="0.01"
                    value={elitePrice}
                    onChange={(e) => setElitePrice(e.target.value)}
                  />
                </div>
              </div>
            )}

            {isSimpleMode && (
              <>
                <div>
                  <Label htmlFor="basePrice">Base Price (£)</Label>
                  <Input
                    id="basePrice"
                    type="number"
                    step="0.01"
                    value={basePrice}
                    onChange={(e) => setBasePrice(e.target.value)}
                    className="w-48"
                  />
                </div>

                {/* Optional Extras */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Optional Extras</Label>
                    <Button type="button" variant="outline" size="sm" onClick={handleAddExtra}>
                      <Plus className="h-4 w-4 mr-1" /> Add Extra
                    </Button>
                  </div>
                  {extras.map((extra, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                      <Input
                        placeholder="Label"
                        value={extra.label}
                        onChange={(e) => handleExtraChange(index, 'label', e.target.value)}
                        className="flex-1"
                      />
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500">£</span>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Price"
                          value={(extra.priceInPence / 100).toFixed(2)}
                          onChange={(e) => handleExtraChange(index, 'priceInPence', e.target.value)}
                          className="w-24"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveExtra(index)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Edit Reason */}
          <div>
            <Label htmlFor="editReason">Reason for Edit (optional)</Label>
            <Input
              id="editReason"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="e.g., Customer requested additional work"
            />
          </div>
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
