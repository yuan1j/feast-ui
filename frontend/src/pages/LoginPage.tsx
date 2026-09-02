import React, { useState } from "react";
import {
  EuiButton,
  EuiCallOut,
  EuiFieldPassword,
  EuiFieldText,
  EuiForm,
  EuiFormRow,
  EuiHorizontalRule,
  EuiSpacer,
  EuiText,
} from "@elastic/eui";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const { colorMode } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isDark = colorMode === "dark";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Please enter a username and password");
      return;
    }
    setError("");
    setIsSubmitting(true);
    const ok = await login(username.trim(), password);
    setIsSubmitting(false);
    if (!ok) {
      setError("Incorrect username or password. Please log in with admin / admin");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: isDark
          ? "linear-gradient(160deg, #171B2E 0%, #26292F 100%)"
          : "linear-gradient(160deg, #F4F4F4 0%, #FFFFFF 100%)",
      }}
    >
      <img
        src="/logo-fcis.svg"
        alt="FCIS"
        style={{ height: 56, width: "auto", marginBottom: 16 }}
      />
      <EuiText textAlign="center">
        <h2 style={{ margin: 0, color: isDark ? "#FFFFFF" : "#1A1A1A" }}>
          FCIS Feature Platform
        </h2>
      </EuiText>
      <EuiSpacer size="xl" />

      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: isDark ? "#1E2230" : "#FFFFFF",
          borderRadius: 12,
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.12)",
          padding: 32,
          border: `1px solid ${isDark ? "#2C3242" : "#E6E6E6"}`,
        }}
      >
        <EuiForm component="form" onSubmit={handleSubmit}>
          <EuiFormRow label="Username" fullWidth>
            <EuiFieldText
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              fullWidth
              autoFocus
            />
          </EuiFormRow>
          <EuiSpacer size="m" />
          <EuiFormRow label="Password" fullWidth>
            <EuiFieldPassword
              type="dual"
              placeholder="admin"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
            />
          </EuiFormRow>
          {error && (
            <>
              <EuiSpacer size="m" />
              <EuiCallOut
                title={error}
                color="danger"
                iconType="alert"
                size="s"
              />
            </>
          )}
          <EuiSpacer size="l" />
          <EuiButton
            type="submit"
            fill
            fullWidth
            isLoading={isSubmitting}
            color="primary"
          >
            Sign In
          </EuiButton>
        </EuiForm>
        <EuiSpacer size="m" />
        <EuiHorizontalRule margin="m" />
        <EuiText size="xs" textAlign="center" color="subdued">
          Default account: admin / admin
        </EuiText>
      </div>
    </div>
  );
};

export default LoginPage;
