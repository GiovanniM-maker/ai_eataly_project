import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: '#1a1a1a',
          color: '#fff',
          padding: '20px',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>⚠️ Errore nell'applicazione</h1>
          <p style={{ marginBottom: '16px', color: '#ccc' }}>
            Si è verificato un errore durante il caricamento dell'applicazione.
          </p>
          {this.state.error && (
            <details style={{ 
              marginTop: '16px', 
              padding: '16px', 
              backgroundColor: '#2a2a2a', 
              borderRadius: '8px',
              maxWidth: '600px',
              width: '100%'
            }}>
              <summary style={{ cursor: 'pointer', marginBottom: '8px' }}>
                Dettagli errore
              </summary>
              <pre style={{ 
                fontSize: '12px', 
                overflow: 'auto',
                color: '#ff6b6b'
              }}>
                {this.state.error.toString()}
                {this.state.errorInfo && this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Ricarica pagina
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

