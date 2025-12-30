import { useState } from 'react';
import { useLocation } from 'wouter';
import { Mail, Lock, Eye, EyeOff, Wrench, ArrowRight, User, Phone, MapPin, Check } from 'lucide-react';

export default function ContractorRegister() {
    const [, setLocation] = useLocation();
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        postcode: '',
        password: '',
        confirmPassword: '',
    });
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [step, setStep] = useState(1);

    const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [field]: e.target.value });
        setError('');
    };

    const validateStep1 = () => {
        if (!formData.firstName.trim() || !formData.lastName.trim()) {
            setError('Please enter your full name');
            return false;
        }
        if (!formData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            setError('Please enter a valid email address');
            return false;
        }
        return true;
    };

    const validateStep2 = () => {
        if (formData.password.length < 8) {
            setError('Password must be at least 8 characters');
            return false;
        }
        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return false;
        }
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (step === 1) {
            if (validateStep1()) {
                setStep(2);
            }
            return;
        }

        if (!validateStep2()) {
            return;
        }

        setError('');
        setIsLoading(true);

        try {
            const response = await fetch('/api/contractor/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    firstName: formData.firstName,
                    lastName: formData.lastName,
                    email: formData.email,
                    phone: formData.phone,
                    postcode: formData.postcode,
                    password: formData.password,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Registration failed');
            }

            // Store token and user info
            localStorage.setItem('contractorToken', data.token);
            localStorage.setItem('contractorUser', JSON.stringify(data.user));
            localStorage.setItem('contractorProfileId', data.profileId);

            // Redirect to service area setup
            setLocation('/contractor/service-area');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    };

    const benefits = [
        'Receive job assignments directly',
        'Manage your availability with our calendar',
        'Track earnings and completed jobs',
        'Get notified of new opportunities',
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-5">
                <div className="absolute inset-0" style={{
                    backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
                    backgroundSize: '40px 40px'
                }} />
            </div>

            <div className="relative w-full max-w-4xl grid md:grid-cols-2 gap-8">
                {/* Left Side - Benefits */}
                <div className="hidden md:flex flex-col justify-center">
                    <img src="/logo.png" alt="Logo" className="w-24 h-24 mb-8 object-contain" />
                    <h1 className="text-4xl font-bold text-white mb-4">
                        Join Our Network
                    </h1>
                    <p className="text-slate-400 text-lg mb-8">
                        Become a verified contractor and start receiving job assignments today.
                    </p>

                    <div className="space-y-4">
                        {benefits.map((benefit, index) => (
                            <div key={index} className="flex items-center gap-3">
                                <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                                    <Check className="w-4 h-4 text-amber-400" />
                                </div>
                                <span className="text-slate-300">{benefit}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Side - Form */}
                <div>
                    {/* Mobile Header */}
                    <div className="md:hidden text-center mb-8">
                        <img src="/logo.png" alt="Logo" className="w-16 h-16 mb-4 object-contain mx-auto" />
                        <h1 className="text-2xl font-bold text-white">Create Account</h1>
                    </div>

                    {/* Form Card */}
                    <div className="bg-white/10 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl p-8">
                        {/* Step Indicator */}
                        <div className="flex items-center gap-3 mb-6">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step === 1 ? 'bg-amber-500 text-white' : 'bg-amber-500/20 text-amber-400'}`}>
                                1
                            </div>
                            <div className={`flex-1 h-1 rounded-full ${step > 1 ? 'bg-amber-500' : 'bg-white/10'}`} />
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step === 2 ? 'bg-amber-500 text-white' : 'bg-white/10 text-slate-500'}`}>
                                2
                            </div>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {/* Error Message */}
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">
                                    {error}
                                </div>
                            )}

                            {step === 1 && (
                                <>
                                    {/* Name Fields */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                                First Name
                                            </label>
                                            <div className="relative">
                                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                                <input
                                                    type="text"
                                                    value={formData.firstName}
                                                    onChange={handleChange('firstName')}
                                                    placeholder="John"
                                                    required
                                                    className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-2">
                                                Last Name
                                            </label>
                                            <input
                                                type="text"
                                                value={formData.lastName}
                                                onChange={handleChange('lastName')}
                                                placeholder="Smith"
                                                required
                                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                                            />
                                        </div>
                                    </div>

                                    {/* Email Field */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">
                                            Email Address
                                        </label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                            <input
                                                type="email"
                                                value={formData.email}
                                                onChange={handleChange('email')}
                                                placeholder="you@example.com"
                                                required
                                                className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                                            />
                                        </div>
                                    </div>

                                    {/* Phone Field */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">
                                            Phone Number
                                        </label>
                                        <div className="relative">
                                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                            <input
                                                type="tel"
                                                value={formData.phone}
                                                onChange={handleChange('phone')}
                                                placeholder="+44 7700 900000"
                                                className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                                            />
                                        </div>
                                    </div>

                                    {/* Postcode Field */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">
                                            Service Area (Postcode)
                                        </label>
                                        <div className="relative">
                                            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                            <input
                                                type="text"
                                                value={formData.postcode}
                                                onChange={handleChange('postcode')}
                                                placeholder="SW1A 1AA"
                                                className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                                            />
                                        </div>
                                        <p className="text-xs text-slate-500 mt-1">We'll show you jobs near this area</p>
                                    </div>
                                </>
                            )}

                            {step === 2 && (
                                <>
                                    {/* Password Field */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">
                                            Create Password
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                            <input
                                                type={showPassword ? 'text' : 'password'}
                                                value={formData.password}
                                                onChange={handleChange('password')}
                                                placeholder="Min. 8 characters"
                                                required
                                                minLength={8}
                                                className="w-full pl-11 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                            >
                                                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Confirm Password Field */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300 mb-2">
                                            Confirm Password
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                                            <input
                                                type={showPassword ? 'text' : 'password'}
                                                value={formData.confirmPassword}
                                                onChange={handleChange('confirmPassword')}
                                                placeholder="Confirm your password"
                                                required
                                                className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                                            />
                                        </div>
                                    </div>

                                    {/* Terms */}
                                    <div className="flex items-start gap-2">
                                        <input
                                            type="checkbox"
                                            required
                                            className="mt-1 w-4 h-4 rounded border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500/50"
                                        />
                                        <span className="text-sm text-slate-400">
                                            I agree to the{' '}
                                            <button type="button" className="text-amber-400 hover:text-amber-300">Terms of Service</button>
                                            {' '}and{' '}
                                            <button type="button" className="text-amber-400 hover:text-amber-300">Privacy Policy</button>
                                        </span>
                                    </div>
                                </>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-3">
                                {step === 2 && (
                                    <button
                                        type="button"
                                        onClick={() => setStep(1)}
                                        className="flex-1 py-3 px-4 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl border border-white/10 transition-all"
                                    >
                                        Back
                                    </button>
                                )}
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="flex-1 py-3 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-semibold rounded-xl shadow-lg shadow-amber-500/25 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            {step === 1 ? 'Continue' : 'Create Account'}
                                            <ArrowRight className="w-5 h-5" />
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>

                        {/* Login Link */}
                        <div className="mt-6 pt-6 border-t border-white/10 text-center">
                            <p className="text-slate-400 text-sm">
                                Already have an account?{' '}
                                <button
                                    onClick={() => setLocation('/contractor/login')}
                                    className="text-amber-400 hover:text-amber-300 font-medium transition-colors"
                                >
                                    Sign in
                                </button>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
