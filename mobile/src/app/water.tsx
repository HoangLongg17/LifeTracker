import { Redirect, useLocalSearchParams } from 'expo-router';

export default function WaterJournalLink() {
  const params = useLocalSearchParams<{ date?: string; savedTime?: string; savedAmount?: string; edited?: string }>();
  return <Redirect href={{ pathname: '/journal', params }} />;
}
