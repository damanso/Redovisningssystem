// User types
export interface User {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'user' | 'accountant';
  createdAt: string;
  updatedAt: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Customer types
export interface Customer {
  id: string;
  name: string;
  organizationNumber: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  notes?: string;
  contactPerson?: string;
  paymentTerms: number;
  createdAt: string;
  updatedAt: string;
}

// Invoice types
export interface InvoiceItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customer?: Customer;
  issueDate: string;
  dueDate: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  items: InvoiceItem[];
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
  notes?: string;
  paymentReference?: string;
  createdAt: string;
  updatedAt: string;
}

// Receipt types
export interface Receipt {
  id: string;
  supplierId?: string;
  amount: number;
  vatAmount: number;
  date: string;
  description: string;
  category: string;
  imageUrl?: string;
  ocrData?: {
    supplierName?: string;
    amount?: number;
    date?: string;
    vatAmount?: number;
  };
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
}

// Dashboard types
export interface DashboardStats {
  totalRevenue: number;
  totalExpenses: number;
  pendingInvoices: number;
  overdueInvoices: number;
  monthlyRevenue: Array<{month: string; amount: number}>;
  topCustomers: Array<{name: string; amount: number}>;
  recentInvoices: Invoice[];
}

// Notification types
export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'invoice' | 'payment' | 'reminder' | 'system';
  read: boolean;
  createdAt: string;
  data?: any;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Navigation types
export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Main: undefined;
};

export type MainTabParamList = {
  Dashboard: undefined;
  Invoices: undefined;
  Customers: undefined;
  Receipts: undefined;
  More: undefined;
};

export type InvoiceStackParamList = {
  InvoiceList: undefined;
  InvoiceDetail: {invoiceId: string};
  InvoiceCreate: undefined;
  InvoiceEdit: {invoiceId: string};
};

export type CustomerStackParamList = {
  CustomerList: undefined;
  CustomerDetail: {customerId: string};
  CustomerCreate: undefined;
  CustomerEdit: {customerId: string};
};

export type ReceiptStackParamList = {
  ReceiptList: undefined;
  ReceiptDetail: {receiptId: string};
  ReceiptScan: undefined;
};

// Storage types
export interface OfflineData {
  invoices: Invoice[];
  customers: Customer[];
  receipts: Receipt[];
  lastSync: string;
}

// Form types
export interface LoginForm {
  email: string;
  password: string;
}

export interface RegisterForm {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
}

export interface CustomerForm {
  name: string;
  organizationNumber: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  notes?: string;
  contactPerson?: string;
  paymentTerms: number;
}

export interface InvoiceForm {
  customerId: string;
  issueDate: string;
  dueDate: string;
  items: InvoiceItem[];
  notes?: string;
}
