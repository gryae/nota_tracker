// ==========================================================================
// NOTA TRACKER — CLIENT CORE LIBRARY
// ==========================================================================

// Global Toast System
const Toast = {
  container: null,

  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },

  show(message, type = 'success', duration = 4000) {
    this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icon = type === 'success' ? '✅' : '❌';
    
    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <div class="toast-content">${message}</div>
      <button class="toast-close">&times;</button>
    `;

    // Add close button action
    toast.querySelector('.toast-close').addEventListener('click', () => {
      this.remove(toast);
    });

    this.container.appendChild(toast);

    // Auto-remove after duration
    const timeoutId = setTimeout(() => {
      this.remove(toast);
    }, duration);

    toast.dataset.timeoutId = timeoutId;
  },

  remove(toast) {
    if (toast.dataset.timeoutId) {
      clearTimeout(Number(toast.dataset.timeoutId));
    }
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, 1rem)';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }
};

// Authentication & Session Helper
const Auth = {
  setSession(token, user) {
    localStorage.setItem('nota_token', token);
    localStorage.setItem('nota_user', JSON.stringify(user));
  },

  getToken() {
    return localStorage.getItem('nota_token');
  },

  getUser() {
    const user = localStorage.getItem('nota_user');
    return user ? JSON.parse(user) : null;
  },

  logout() {
    localStorage.removeItem('nota_token');
    localStorage.removeItem('nota_user');
    window.location.href = 'index.html';
  },

  decodeToken(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) {
      return null;
    }
  },

  checkSession(requiredRole = null) {
    const token = this.getToken();
    if (!token) {
      this.logout();
      return false;
    }

    const payload = this.decodeToken(token);
    if (!payload) {
      this.logout();
      return false;
    }

    // Check JWT expiry
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      Toast.show('Sesi telah kedaluwarsa. Silakan login kembali.', 'error');
      setTimeout(() => this.logout(), 1500);
      return false;
    }

    // Check specific role if required
    if (requiredRole && payload.role !== requiredRole) {
      Toast.show('Anda tidak memiliki akses ke halaman ini.', 'error');
      setTimeout(() => {
        if (payload.role === 'admin') {
          window.location.href = 'admin.html';
        } else {
          window.location.href = 'dashboard.html';
        }
      }, 1500);
      return false;
    }

    return true;
  }
};

// API Client wrapper
async function apiFetch(endpoint, options = {}) {
  const token = Auth.getToken();
  
  // Set headers
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchOptions = {
    ...options,
    headers
  };

  try {
    const response = await fetch(endpoint, fetchOptions);
    
    // Handle HTTP errors
    if (response.status === 401 || response.status === 403) {
      // If we are not on the login page, redirect to login
      if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
        Auth.logout();
        return null;
      }
    }

    // Handle CSV or file downloads
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/csv')) {
      return response.text();
    }

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Terjadi kesalahan sistem.');
    }
    
    return data;
  } catch (err) {
    Toast.show(err.message, 'error');
    throw err;
  }
}

// Setup common UI parts (like Navbar user tags & logout actions)
function setupNavbar() {
  const user = Auth.getUser();
  const token = Auth.getToken();
  
  if (!user || !token) return;

  // Render Navbar details dynamically
  const navbarElement = document.querySelector('.navbar');
  if (navbarElement) {
    const navUserDiv = document.querySelector('.nav-user');
    if (navUserDiv) {
      const displayName = user.role === 'admin' ? 'Administrator' : user.nama_divisi;
      
      let navLinksHTML = '';
      if (user.role === 'admin') {
        navLinksHTML = `
          <div class="nav-links">
            <a href="admin.html" class="nav-link ${window.location.pathname.endsWith('admin.html') ? 'active' : ''}">Manajemen</a>
            <a href="laporan.html" class="nav-link ${window.location.pathname.endsWith('laporan.html') ? 'active' : ''}">Laporan</a>
          </div>
        `;
      } else {
        navLinksHTML = `
          <div class="nav-links">
            <a href="dashboard.html" class="nav-link active">Workspace</a>
          </div>
        `;
      }

      navUserDiv.innerHTML = `
        ${navLinksHTML}
        <div class="user-tag">${displayName}</div>
        <button id="logoutBtn" class="btn-logout">Logout</button>
      `;

      // Attach logout listener
      document.getElementById('logoutBtn').addEventListener('click', () => {
        Auth.logout();
      });
    }
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  setupNavbar();
});
