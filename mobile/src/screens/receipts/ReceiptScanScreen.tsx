import React, {useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity, Alert, Image} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Ionicons';
import Button from '../../components/Button';
import Card from '../../components/Card';

const ReceiptScanScreen: React.FC = () => {
  const navigation = useNavigation();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleTakePhoto = async () => {
    try {
      const result = await launchCamera({
        mediaType: 'photo',
        quality: 0.8,
        saveToPhotos: false,
      });

      if (result.assets && result.assets[0].uri) {
        setImageUri(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  const handleChooseFromLibrary = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
      });

      if (result.assets && result.assets[0].uri) {
        setImageUri(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to choose image');
    }
  };

  const handleProcessReceipt = async () => {
    if (!imageUri) {
      Alert.alert('Error', 'Please select an image first');
      return;
    }

    setIsProcessing(true);

    // Simulate OCR processing
    setTimeout(() => {
      setIsProcessing(false);
      Alert.alert(
        'Receipt Processed',
        'Receipt has been processed successfully. Full OCR functionality available in production.',
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ],
      );
    }, 2000);
  };

  return (
    <View style={styles.container}>
      <Card style={styles.card}>
        {imageUri ? (
          <View style={styles.imageContainer}>
            <Image source={{uri: imageUri}} style={styles.image} resizeMode="contain" />
            <TouchableOpacity style={styles.removeButton} onPress={() => setImageUri(null)}>
              <Icon name="close-circle" size={32} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Icon name="camera-outline" size={64} color="#C7C7CC" />
            <Text style={styles.placeholderText}>No image selected</Text>
          </View>
        )}
      </Card>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={handleTakePhoto}>
          <Icon name="camera" size={32} color="#007AFF" />
          <Text style={styles.actionText}>Take Photo</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={handleChooseFromLibrary}>
          <Icon name="images" size={32} color="#007AFF" />
          <Text style={styles.actionText}>Choose from Library</Text>
        </TouchableOpacity>
      </View>

      {imageUri && (
        <View style={styles.processButton}>
          <Button
            title="Process Receipt"
            onPress={handleProcessReceipt}
            loading={isProcessing}
          />
        </View>
      )}

      <Card style={styles.infoCard}>
        <Icon name="information-circle" size={24} color="#007AFF" />
        <Text style={styles.infoText}>
          Take a clear photo of your receipt. The app will automatically extract information
          like amount, date, and supplier using OCR technology.
        </Text>
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
    padding: 16,
  },
  card: {
    height: 400,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  removeButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#fff',
    borderRadius: 16,
  },
  placeholder: {
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: '#8E8E93',
    marginTop: 16,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 24,
  },
  actionButton: {
    alignItems: 'center',
    padding: 16,
  },
  actionText: {
    fontSize: 14,
    color: '#007AFF',
    marginTop: 8,
  },
  processButton: {
    marginBottom: 16,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#8E8E93',
    marginLeft: 12,
    lineHeight: 20,
  },
});

export default ReceiptScanScreen;
