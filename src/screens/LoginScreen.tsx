import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  useWindowDimensions, 
  KeyboardAvoidingView, 
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert
} from 'react-native';
import { useAuth } from '../hooks/useAuth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  
  const { width, height } = useWindowDimensions();
  const { login, register, loading } = useAuth();

  const isLandscape = width > height;

  const handleAuthAction = async () => {
    if (!email || !password) {
      Alert.alert('Validation Error', 'Please complete all input fields.');
      return;
    }

    try {
      if (isSignUp) {
        await register(email, password);
        Alert.alert('Success', 'Treasi profile registered successfully!');
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      Alert.alert('Authentication Error', err.message);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
    >
      <ScrollView 
        contentContainerStyle={[
          styles.scrollContainer, 
          isLandscape ? styles.landscapeLayout : styles.portraitLayout
        ]}
      >
        {/* Responsive Branding Panel */}
        <View style={[styles.brandSection, { width: isLandscape ? '40%' : '100%' }]}>
          <Text style={styles.logoText}>Treasi 🗺️</Text>
          <Text style={styles.tagline}>Hide. Explore. Stay connected.</Text>
        </View>

        {/* Input Interactive Form Elements */}
        <View style={[styles.formSection, { width: isLandscape ? '50%' : '100%' }]}>
          <TextInput
            style={styles.input}
            placeholder="Email Address"
            placeholderTextColor="#888"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#888"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            editable={!loading}
          />
          
          <TouchableOpacity 
            style={[styles.primaryButton, loading && styles.disabledButton]} 
            onPress={handleAuthAction}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>
                {isSignUp ? 'Create Cloud Account' : 'Authenticate Session'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => setIsSignUp(!isSignUp)} 
            style={styles.switchModeContainer}
            disabled={loading}
          >
            <Text style={styles.switchModeText}>
              {isSignUp ? 'Already registered? Sign In' : "New to the hunt? Register here"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#12141C',
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  portraitLayout: {
    flexDirection: 'column',
  },
  landscapeLayout: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFF',
    letterSpacing: 1.5,
  },
  tagline: {
    fontSize: 14,
    color: '#8A94A6',
    marginTop: 8,
    textAlign: 'center',
  },
  formSection: {
    gap: 14,
  },
  input: {
    backgroundColor: '#1E2230',
    color: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2C3248',
  },
  primaryButton: {
    backgroundColor: '#3861FB',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 6,
  },
  disabledButton: {
    backgroundColor: '#1E295D',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  switchModeContainer: {
    alignItems: 'center',
    marginTop: 8,
  },
  switchModeText: {
    color: '#8A94A6',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});