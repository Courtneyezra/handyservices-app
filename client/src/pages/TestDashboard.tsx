export default function TestDashboard() {
    return (
        <div style={{ padding: '20px', background: 'white', minHeight: '100vh' }}>
            <h1>Test Dashboard - If you see this, routing works!</h1>
            <p>Current URL: {window.location.href}</p>
            <p>This is a minimal test component to verify the route is working.</p>
        </div>
    );
}
